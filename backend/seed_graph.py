"""
backend/seed_graph.py

Math Knowledge Graph – CSV Ingestion Script
============================================

Purpose
-------
One-shot script for importing the initial knowledge graph from two Airtable
CSV exports into the Supabase PostgreSQL database:

    nodes.csv  – concept metadata (one row per concept)
    edges.csv  – prerequisite relationships (one row per edge)

Expected CSV column headers
---------------------------
nodes.csv:
    concept_code, grade_level, topic_category, concept_name_vn,
    concept_description, mastery_question

edges.csv:
    target_concept_code, source_concept_code, relationship_type

Usage
-----
    # Minimal (CSVs in the current working directory)
    python -m backend.seed_graph

    # Explicit paths and dry-run mode
    python -m backend.seed_graph \\
        --nodes  data/nodes.csv \\
        --edges  data/edges.csv \\
        --dry-run

Environment variables required
-------------------------------
    DIRECT_DB_URL            – psycopg2 connection string (preferred)
    SUPABASE_URL             – Supabase project URL  (fallback)
    SUPABASE_SERVICE_ROLE_KEY – Supabase service secret (fallback)

Design notes
------------
- Uses Python's built-in ``csv`` module (no pandas dependency) for maximum
  portability and to keep the Docker image lean.
- Nodes are inserted first; each successfully inserted row's UUID is captured
  in an in-memory ``concept_code → UUID`` map.
- Edges are inserted second, looking up UUIDs from the map.  Any edge referencing
  an unknown concept_code is skipped with a clear warning.
- The script is idempotent: Supabase's ``upsert`` (ON CONFLICT DO NOTHING) is
  used so re-running on already-seeded data is safe.
- Progress is printed to stdout with counters; errors are printed to stderr.
"""

from __future__ import annotations

import argparse
import csv
import logging
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from uuid import UUID

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Column definitions
# ---------------------------------------------------------------------------

# These must exactly match the CSV header row exported from Airtable.
NODES_REQUIRED_COLUMNS: Tuple[str, ...] = (
    "concept_code",
    "grade_level",
    "topic_category",
    "concept_name_vn",
)
NODES_OPTIONAL_COLUMNS: Tuple[str, ...] = (
    "concept_description",
    "mastery_question",
)

EDGES_REQUIRED_COLUMNS: Tuple[str, ...] = (
    "target_concept_code",
    "source_concept_code",
    "relationship_type",
)

VALID_RELATIONSHIP_TYPES = {"HARD_PREREQUISITE", "SOFT_PREREQUISITE"}


# ---------------------------------------------------------------------------
# CSV ingestion helpers
# ---------------------------------------------------------------------------


def _read_csv(filepath: Path) -> List[Dict[str, str]]:
    """
    Read a CSV file and return a list of row dicts.

    Each dict maps column header → string value.  Empty fields are normalised
    to empty string (not None) for uniform handling downstream.

    Parameters
    ----------
    filepath: Absolute or relative path to the CSV file.

    Returns
    -------
    List of row dicts.  Empty rows are silently skipped.

    Raises
    ------
    FileNotFoundError: If the file does not exist.
    ValueError: If the file is empty or has no header row.
    """
    if not filepath.exists():
        raise FileNotFoundError(
            f"CSV file not found: {filepath}.  "
            "Ensure the file exists or pass --nodes / --edges flags."
        )

    rows: List[Dict[str, str]] = []
    with filepath.open(newline="", encoding="utf-8-sig") as fh:
        # utf-8-sig strips the BOM that Excel / Airtable sometimes adds.
        reader = csv.DictReader(fh)
        if reader.fieldnames is None:
            raise ValueError(f"CSV file appears to be empty: {filepath}")
        for row in reader:
            # Skip fully blank rows.
            if not any(row.values()):
                continue
            rows.append({k: (v or "").strip() for k, v in row.items()})

    logger.info("  Read %d data rows from %s", len(rows), filepath.name)
    return rows


def _validate_columns(
    rows: List[Dict[str, str]],
    required: Tuple[str, ...],
    source_name: str,
) -> None:
    """
    Verify that all required column headers are present in the CSV.

    Raises
    ------
    ValueError: With a descriptive message listing the missing columns.
    """
    if not rows:
        return
    present = set(rows[0].keys())
    missing = set(required) - present
    if missing:
        raise ValueError(
            f"{source_name} is missing required columns: {sorted(missing)}.  "
            f"Columns found: {sorted(present)}"
        )


# ---------------------------------------------------------------------------
# Database backends
# ---------------------------------------------------------------------------


def _get_psycopg2_conn():
    """
    Open a psycopg2 connection from DIRECT_DB_URL.

    Returns a connection with autocommit=False (we manage transactions).
    """
    try:
        import psycopg2  # type: ignore
        import psycopg2.extras  # type: ignore
    except ImportError as exc:
        raise RuntimeError("pip install psycopg2-binary") from exc

    db_url = os.environ.get("DIRECT_DB_URL")
    if not db_url:
        raise RuntimeError("DIRECT_DB_URL environment variable is not set.")
    conn = psycopg2.connect(db_url, cursor_factory=psycopg2.extras.RealDictCursor)
    conn.autocommit = False
    return conn


def _get_supabase_client():
    """Return a Supabase client (fallback when DIRECT_DB_URL is absent)."""
    try:
        from supabase import create_client  # type: ignore
    except ImportError as exc:
        raise RuntimeError("pip install supabase") from exc

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables."
        )
    return create_client(url, key)


# ---------------------------------------------------------------------------
# Node insertion
# ---------------------------------------------------------------------------


def insert_nodes(
    rows: List[Dict[str, str]],
    dry_run: bool = False,
) -> Dict[str, str]:
    """
    Insert concept nodes from parsed CSV rows into the ``nodes`` table.

    Insertion is idempotent: rows whose ``concept_code`` already exists are
    silently skipped (``ON CONFLICT (concept_code) DO NOTHING``).

    Parameters
    ----------
    rows:    List of CSV row dicts (already validated for required columns).
    dry_run: If True, print what would be inserted but do not touch the DB.

    Returns
    -------
    Dict mapping ``concept_code`` → ``id`` (UUID string) for every node that
    exists in the DB after this operation (both newly inserted and pre-existing).
    """
    print("\n" + "═" * 60)
    print("  PHASE 1 – Inserting NODES")
    print("═" * 60)

    code_to_uuid: Dict[str, str] = {}
    inserted = skipped = errors = 0

    if os.environ.get("DIRECT_DB_URL") and not dry_run:
        # ── psycopg2 path ─────────────────────────────────────────────────
        conn = _get_psycopg2_conn()
        insert_sql = """
            INSERT INTO nodes
                (concept_code, grade_level, topic_category, concept_name_vn,
                 concept_description, mastery_question)
            VALUES
                (%(concept_code)s, %(grade_level)s, %(topic_category)s,
                 %(concept_name_vn)s, %(concept_description)s, %(mastery_question)s)
            ON CONFLICT (concept_code) DO NOTHING
            RETURNING id, concept_code;
        """
        fetch_sql = "SELECT id, concept_code FROM nodes WHERE concept_code = %(code)s;"

        try:
            with conn.cursor() as cur:
                for i, row in enumerate(rows, start=1):
                    params = _build_node_params(row)
                    if params is None:
                        errors += 1
                        continue
                    cur.execute(insert_sql, params)
                    returned = cur.fetchone()
                    if returned:
                        # Newly inserted row.
                        code_to_uuid[returned["concept_code"]] = str(returned["id"])
                        inserted += 1
                        print(
                            f"  [{i:04d}/{len(rows):04d}]  INSERT  {returned['concept_code']}  "
                            f"→  {returned['id']}"
                        )
                    else:
                        # Row already existed (ON CONFLICT DO NOTHING).
                        cur.execute(fetch_sql, {"code": params["concept_code"]})
                        existing = cur.fetchone()
                        if existing:
                            code_to_uuid[existing["concept_code"]] = str(existing["id"])
                        skipped += 1
                        print(
                            f"  [{i:04d}/{len(rows):04d}]  SKIP    {params['concept_code']}  "
                            "(already exists)"
                        )
            conn.commit()
        except Exception as exc:
            conn.rollback()
            logger.error("Node insertion rolled back: %s", exc)
            raise
        finally:
            conn.close()

    elif not dry_run:
        # ── supabase-py path ──────────────────────────────────────────────
        client = _get_supabase_client()

        for i, row in enumerate(rows, start=1):
            params = _build_node_params(row)
            if params is None:
                errors += 1
                continue

            try:
                resp = client.table("nodes").upsert(
                    params, on_conflict="concept_code", ignore_duplicates=True
                ).execute()

                # Fetch the UUID regardless of whether we inserted or skipped.
                fetch_resp = (
                    client.table("nodes")
                    .select("id, concept_code")
                    .eq("concept_code", params["concept_code"])
                    .limit(1)
                    .execute()
                )
                if fetch_resp.data:
                    record = fetch_resp.data[0]
                    code_to_uuid[record["concept_code"]] = record["id"]
                    print(
                        f"  [{i:04d}/{len(rows):04d}]  UPSERT  {record['concept_code']}  "
                        f"→  {record['id']}"
                    )
                    inserted += 1
                else:
                    logger.warning("Could not fetch UUID for %s", params["concept_code"])
                    errors += 1
            except Exception as exc:
                logger.error(
                    "  Error upserting node '%s': %s",
                    params.get("concept_code", "?"),
                    exc,
                )
                errors += 1

    else:
        # ── dry-run path ──────────────────────────────────────────────────
        for i, row in enumerate(rows, start=1):
            params = _build_node_params(row)
            if params is None:
                errors += 1
                continue
            code_to_uuid[params["concept_code"]] = f"<dry-run-uuid-{i}>"
            print(f"  [{i:04d}/{len(rows):04d}]  DRY-RUN  {params['concept_code']}")
            inserted += 1

    print(
        f"\n  ✓ Node insertion complete: "
        f"{inserted} inserted/upserted, {skipped} skipped, {errors} errors.\n"
    )
    return code_to_uuid


def _build_node_params(row: Dict[str, str]) -> Optional[Dict]:
    """
    Convert a raw CSV row dict into a parameterised INSERT payload.

    Returns ``None`` (and logs a warning) if the row fails basic validation.
    """
    code = row.get("concept_code", "").strip().upper()
    if not code:
        logger.warning("Skipping row with empty concept_code: %s", row)
        return None

    grade_raw = row.get("grade_level", "").strip()
    try:
        grade_level = int(grade_raw)
        if not (1 <= grade_level <= 12):
            raise ValueError(f"grade_level must be 1–12, got {grade_level}")
    except ValueError as exc:
        logger.warning(
            "Skipping '%s': invalid grade_level '%s' – %s", code, grade_raw, exc
        )
        return None

    topic = row.get("topic_category", "").strip()
    name_vn = row.get("concept_name_vn", "").strip()
    if not topic or not name_vn:
        logger.warning(
            "Skipping '%s': topic_category and concept_name_vn are required.", code
        )
        return None

    return {
        "concept_code": code,
        "grade_level": grade_level,
        "topic_category": topic,
        "concept_name_vn": name_vn,
        "concept_description": row.get("concept_description", "").strip() or None,
        "mastery_question": row.get("mastery_question", "").strip() or None,
    }


# ---------------------------------------------------------------------------
# Edge insertion
# ---------------------------------------------------------------------------


def insert_edges(
    rows: List[Dict[str, str]],
    code_to_uuid: Dict[str, str],
    dry_run: bool = False,
) -> None:
    """
    Insert prerequisite edges from parsed CSV rows into the ``edges`` table.

    Requires the ``code_to_uuid`` map produced by ``insert_nodes`` to resolve
    concept_codes to database UUIDs.

    Parameters
    ----------
    rows:          List of CSV row dicts (already validated for required columns).
    code_to_uuid:  Mapping of concept_code → UUID string from the nodes phase.
    dry_run:       If True, print what would be inserted without touching the DB.
    """
    print("═" * 60)
    print("  PHASE 2 – Inserting EDGES")
    print("═" * 60)

    inserted = skipped = errors = 0
    edge_params_batch: List[Dict] = []

    # ── Build and validate edge payloads ─────────────────────────────────────
    for i, row in enumerate(rows, start=1):
        target_code = row.get("target_concept_code", "").strip().upper()
        source_code = row.get("source_concept_code", "").strip().upper()
        rel_type = row.get("relationship_type", "").strip().upper()

        # Validate concept codes exist in the UUID map.
        missing = []
        if target_code not in code_to_uuid:
            missing.append(f"target='{target_code}'")
        if source_code not in code_to_uuid:
            missing.append(f"source='{source_code}'")

        if missing:
            logger.warning(
                "  [%04d/%04d]  SKIP edge  %s → %s  — Unknown concept codes: %s",
                i,
                len(rows),
                source_code,
                target_code,
                ", ".join(missing),
            )
            errors += 1
            continue

        # Validate relationship_type.
        if rel_type not in VALID_RELATIONSHIP_TYPES:
            logger.warning(
                "  [%04d/%04d]  SKIP edge  %s → %s  — Invalid relationship_type "
                "'%s'. Must be one of %s.",
                i,
                len(rows),
                source_code,
                target_code,
                rel_type,
                VALID_RELATIONSHIP_TYPES,
            )
            errors += 1
            continue

        # Self-loop guard (mirrors SQL CHECK constraint).
        if target_code == source_code:
            logger.warning(
                "  [%04d/%04d]  SKIP edge  %s → %s  — Self-loop not allowed.",
                i,
                len(rows),
                source_code,
                target_code,
            )
            errors += 1
            continue

        target_uuid = code_to_uuid[target_code]
        source_uuid = code_to_uuid[source_code]

        if dry_run:
            print(
                f"  [{i:04d}/{len(rows):04d}]  DRY-RUN  "
                f"{source_code} ({source_uuid[:8]}…) "
                f"──[{rel_type}]──▶ "
                f"{target_code} ({target_uuid[:8]}…)"
            )
            inserted += 1
            continue

        edge_params_batch.append(
            {
                "target_node_id": target_uuid,
                "source_node_id": source_uuid,
                "relationship_type": rel_type,
            }
        )

    if dry_run:
        print(
            f"\n  ✓ Edge dry-run complete: "
            f"{inserted} would insert, {errors} would skip.\n"
        )
        return

    # ── Bulk insert via psycopg2 ──────────────────────────────────────────────
    if os.environ.get("DIRECT_DB_URL"):
        conn = _get_psycopg2_conn()
        insert_sql = """
            INSERT INTO edges (target_node_id, source_node_id, relationship_type)
            VALUES (%(target_node_id)s, %(source_node_id)s, %(relationship_type)s)
            ON CONFLICT (target_node_id, source_node_id) DO NOTHING;
        """
        try:
            with conn.cursor() as cur:
                for j, params in enumerate(edge_params_batch, start=1):
                    cur.execute(insert_sql, params)
                    affected = cur.rowcount
                    if affected == 1:
                        inserted += 1
                        print(
                            f"  [{j:04d}/{len(edge_params_batch):04d}]  INSERT  "
                            f"{params['source_node_id'][:8]}… "
                            f"──[{params['relationship_type']}]──▶ "
                            f"{params['target_node_id'][:8]}…"
                        )
                    else:
                        skipped += 1
                        print(
                            f"  [{j:04d}/{len(edge_params_batch):04d}]  SKIP    "
                            f"(already exists)"
                        )
            conn.commit()
        except Exception as exc:
            conn.rollback()
            logger.error("Edge insertion rolled back: %s", exc)
            raise
        finally:
            conn.close()

    else:
        # ── supabase-py path ──────────────────────────────────────────────────
        client = _get_supabase_client()
        for j, params in enumerate(edge_params_batch, start=1):
            try:
                client.table("edges").upsert(
                    params,
                    on_conflict="target_node_id,source_node_id",
                    ignore_duplicates=True,
                ).execute()
                inserted += 1
                print(
                    f"  [{j:04d}/{len(edge_params_batch):04d}]  UPSERT  "
                    f"{params['source_node_id'][:8]}… "
                    f"──[{params['relationship_type']}]──▶ "
                    f"{params['target_node_id'][:8]}…"
                )
            except Exception as exc:
                logger.error("Error inserting edge %s: %s", params, exc)
                errors += 1

    print(
        f"\n  ✓ Edge insertion complete: "
        f"{inserted} inserted, {skipped} skipped, {errors} errors.\n"
    )


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------


def main() -> None:
    """
    CLI entrypoint.  Parses arguments, reads CSVs, and runs both ingestion
    phases in order: nodes first, then edges.
    """
    parser = argparse.ArgumentParser(
        description="Seed the Math Knowledge Graph from Airtable CSV exports.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--nodes",
        type=Path,
        default=Path("nodes.csv"),
        metavar="PATH",
        help="Path to nodes.csv (default: ./nodes.csv)",
    )
    parser.add_argument(
        "--edges",
        type=Path,
        default=Path("edges.csv"),
        metavar="PATH",
        help="Path to edges.csv (default: ./edges.csv)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be inserted without modifying the database.",
    )
    args = parser.parse_args()

    print("\n╔══════════════════════════════════════════════════════════╗")
    print("║      Math Knowledge Graph – CSV Seed Script             ║")
    print("╚══════════════════════════════════════════════════════════╝")
    if args.dry_run:
        print("  ⚠  DRY-RUN MODE – no data will be written to the database.\n")

    # ── Phase 1: Read and validate nodes CSV ─────────────────────────────────
    print(f"\nReading nodes from: {args.nodes.resolve()}")
    node_rows = _read_csv(args.nodes)
    _validate_columns(node_rows, NODES_REQUIRED_COLUMNS, "nodes.csv")

    # ── Phase 2: Read and validate edges CSV ─────────────────────────────────
    print(f"Reading edges from: {args.edges.resolve()}")
    edge_rows = _read_csv(args.edges)
    _validate_columns(edge_rows, EDGES_REQUIRED_COLUMNS, "edges.csv")

    # ── Phase 3: Insert nodes and collect UUID map ────────────────────────────
    code_to_uuid = insert_nodes(node_rows, dry_run=args.dry_run)

    # ── Phase 4: Insert edges ─────────────────────────────────────────────────
    insert_edges(edge_rows, code_to_uuid, dry_run=args.dry_run)

    print("╔══════════════════════════════════════════════════════════╗")
    print("║  Seed complete.  The knowledge graph is ready.          ║")
    print("╚══════════════════════════════════════════════════════════╝\n")


if __name__ == "__main__":
    main()
