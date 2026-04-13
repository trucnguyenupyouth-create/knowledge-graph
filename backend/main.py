"""
backend/main.py

Math Knowledge Graph – FastAPI Application Entry Point
=======================================================

Endpoints
---------
GET  /nodes/{concept_code}
    Fetch full details for a single knowledge-graph node by its concept_code.

GET  /graph/prerequisites/{concept_code}
    Run the Recursive CTE traversal and return the complete prerequisite chain,
    ordered from the immediate prerequisite to the deepest root ancestor.

POST /webhook/ai-grading-result
    Receive an AI Vision grading result, look up the immediate HARD prerequisite
    of the failed concept, and instruct the frontend which mastery question to
    load for the student.

Run locally
-----------
    uvicorn backend.main:app --reload --port 8000

    Then open http://localhost:8000/docs for the interactive Swagger UI.

Environment variables
---------------------
    DIRECT_DB_URL            (preferred) – psycopg2 connection string for the
                             Supabase PostgreSQL database.
    SUPABASE_URL             – Supabase project URL (fallback; rpc mode).
    SUPABASE_SERVICE_ROLE_KEY – Supabase service-role secret (fallback; rpc mode).
"""

from __future__ import annotations

import logging
import os
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Path, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.graph_engine import (
    PrerequisiteChainResult,
    get_immediate_prerequisite,
    get_prerequisite_chain,
)
from backend.models import Node
from backend.diagnostic_engine import match_error_to_concept

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Math Knowledge Graph API",
    description=(
        "Adaptive EdTech platform backend.  "
        "Provides knowledge-graph traversal, node metadata, and AI grading "
        "webhook integration for the adaptive remediation engine."
    ),
    version="1.0.0",
    docs_url="/docs",        # Swagger UI
    redoc_url="/redoc",      # ReDoc UI
    openapi_url="/openapi.json",
    contact={
        "name": "EdTech Platform Team",
        "email": "dev@edtech.local",
    },
    license_info={
        "name": "Proprietary",
    },
)

# ---------------------------------------------------------------------------
# CORS middleware
# ---------------------------------------------------------------------------
# All origins are allowed for now (development mode).  Before going to
# production, replace allow_origins=["*"] with your explicit frontend origin(s),
# e.g. ["https://app.yourplatform.vn"].

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # TODO: restrict to known origins in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request / Response schemas (endpoint-specific)
# ---------------------------------------------------------------------------


class AIGradingWebhookPayload(BaseModel):
    """
    Payload sent by the external AI Vision grading service when a student
    answer has been evaluated.
    """

    student_id: str = Field(
        ...,
        min_length=1,
        description="Unique identifier of the student within the platform.",
        examples=["stu_123"],
    )
    failed_concept_code: str = Field(
        ...,
        min_length=1,
        description=(
            "The concept_code of the concept the student failed to demonstrate "
            "mastery of.  Example: 'ALG_G8_05'."
        ),
        examples=["ALG_G8_05"],
    )


class RemediationInstruction(BaseModel):
    """
    Response sent back to the frontend after processing an AI grading result.

    The frontend should immediately render the ``mastery_question`` for the
    student as the next learning step.
    """

    student_id: str = Field(..., description="Echoed from the webhook payload.")
    failed_concept_code: str = Field(
        ..., description="The concept the student failed."
    )
    action: str = Field(
        ...,
        description=(
            "Instruction for the frontend.  "
            "'LOAD_PREREQUISITE_QUESTION' → display the prerequisite mastery "
            "question.  'NO_PREREQUISITE_FOUND' → the concept is foundational; "
            "surface a review of the concept itself."
        ),
        examples=["LOAD_PREREQUISITE_QUESTION"],
    )
    prerequisite_concept_code: Optional[str] = Field(
        None,
        description="concept_code of the prerequisite to remediate, if found.",
    )
    mastery_question: Optional[str] = Field(
        None,
        description=(
            "The exact diagnostic question to present to the student. "
            "NULL when no prerequisite was found."
        ),
    )
    message: str = Field(
        ...,
        description="Human-readable summary of the remediation decision.",
    )


class DiagnosticRequest(BaseModel):
    """
    Payload for the AI Diagnostic Matcher.
    """
    problem_statement: str = Field(..., description="The original math problem statement.")
    student_mistake_description: str = Field(..., description="The tutor's description of the student's mistake.")
    target_concept_code: Optional[str] = Field(None, description="Optional target concept code the problem belongs to.")


class DiagnosticResponse(BaseModel):
    """
    Response for the AI Diagnostic Matcher containing the Gemini analysis
    and the corresponding prerequisite chain.
    """
    matched_concept_code: Optional[str]
    thinking_log: Optional[str]
    explanation: str
    prerequisite_chain: Optional[PrerequisiteChainResult]


# ---------------------------------------------------------------------------
# Utility: resolve concept_code from path / payload
# ---------------------------------------------------------------------------

def _normalise_code(raw: str) -> str:
    """Strip whitespace and upper-case a concept_code received from the caller."""
    return raw.strip().upper()


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------


@app.get(
    "/health",
    tags=["System"],
    summary="Service health check",
    response_description="Returns 200 OK when the service is running.",
)
async def health_check() -> dict:
    """
    Lightweight health-check used by load balancers and deployment pipelines.

    Returns a JSON object with ``status`` and ``version``.
    """
    return {"status": "ok", "version": app.version}


# ---------------------------------------------------------------------------
# Node endpoints
# ---------------------------------------------------------------------------


@app.get(
    "/nodes/{concept_code}",
    tags=["Nodes"],
    summary="Get node by concept code",
    response_model=Node,
    responses={
        200: {"description": "Node found and returned successfully."},
        404: {"description": "No node with the given concept_code exists."},
        500: {"description": "Internal server error (database unreachable)."},
    },
)
async def get_node(
    concept_code: str = Path(
        ...,
        title="Concept Code",
        description=(
            "The stable curriculum identifier of the concept to retrieve.  "
            "Example: 'G6_FRAC_ADD'."
        ),
        min_length=3,
        max_length=64,
        examples=["G6_FRAC_ADD"],
    ),
) -> Node:
    """
    Fetch the full details of a single knowledge-graph **node** identified by
    its ``concept_code``.

    The ``concept_code`` is a human-readable, curriculum-stable identifier
    (e.g. ``G6_FRAC_ADD`` for *Grade 6 – Fraction Addition*) that uniquely
    maps to one conceptual unit in the Math knowledge graph.

    **Use cases**
    - Display a concept's description and mastery question in the student UI.
    - Validate that a concept exists before creating graph edges.

    **Error handling**
    - Returns **404** if the concept_code is not found.
    - Returns **500** on database connectivity failures.
    """
    code = _normalise_code(concept_code)
    logger.info("GET /nodes/%s", code)

    try:
        # Re-use the existence check + simple lookup from the graph engine.
        # We query the nodes table directly here via supabase-py or psycopg2.
        node = _fetch_node_by_code(code)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except RuntimeError as exc:
        logger.exception("Database error in GET /nodes/%s", code)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )

    return node


# ---------------------------------------------------------------------------
# Graph traversal endpoints
# ---------------------------------------------------------------------------


@app.get(
    "/graph/prerequisites/{concept_code}",
    tags=["Graph Traversal"],
    summary="Get full prerequisite chain for a concept",
    response_model=PrerequisiteChainResult,
    responses={
        200: {"description": "Prerequisite chain returned (may be empty list)."},
        404: {"description": "No node with the given concept_code exists."},
        500: {"description": "Internal server error (database unreachable)."},
    },
)
async def get_prerequisites(
    concept_code: str = Path(
        ...,
        title="Concept Code",
        description=(
            "The concept_code to find prerequisites for.  "
            "The traversal walks backwards through ALL ancestor nodes, not just "
            "the immediate parent.  Example: 'G9_ALG_QUAD_EQ'."
        ),
        min_length=3,
        max_length=64,
        examples=["G9_ALG_QUAD_EQ"],
    ),
) -> PrerequisiteChainResult:
    """
    Execute a **recursive prerequisite traversal** starting from the given
    concept, returning every ancestor node all the way down to the foundational
    root concepts.

    The traversal is implemented as a single PostgreSQL **Recursive CTE** so it
    requires only one database round-trip regardless of graph depth.

    **Response structure**

    ```json
    {
      "target_concept_code": "G9_ALG_QUAD_EQ",
      "total_prerequisites": 4,
      "chain": [
        { "depth": 1, "concept_code": "G8_ALG_LINEAR_EQ", ... },
        { "depth": 2, "concept_code": "G7_ALG_EXPR",      ... },
        { "depth": 3, "concept_code": "G6_ARITH_MULT",    ... },
        { "depth": 4, "concept_code": "G5_ARITH_ADD",     ... }
      ]
    }
    ```

    The ``chain`` array is ordered **shallowest first** (``depth=1`` = immediate
    prerequisite), which is the natural remediation order for the adaptive engine.

    **Edge case behaviour**
    - A concept with no prerequisites returns ``chain: []`` with
      ``total_prerequisites: 0`` (not a 404).
    - Diamond-shaped DAGs (a node reachable via multiple paths) are handled
      correctly: each node appears **once** at its *shortest* depth.
    """
    code = _normalise_code(concept_code)
    logger.info("GET /graph/prerequisites/%s", code)

    try:
        result = get_prerequisite_chain(code)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except RuntimeError as exc:
        logger.exception("DB error in GET /graph/prerequisites/%s", code)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )

    return result


# ---------------------------------------------------------------------------
# AI Grading webhook
# ---------------------------------------------------------------------------


@app.post(
    "/webhook/ai-grading-result",
    tags=["Webhooks"],
    summary="Process an AI grading result and return a remediation instruction",
    response_model=RemediationInstruction,
    status_code=status.HTTP_200_OK,
    responses={
        200: {"description": "Remediation instruction generated successfully."},
        404: {"description": "The failed_concept_code does not exist in the graph."},
        422: {"description": "Invalid payload (validation error)."},
        500: {"description": "Internal server error (database unreachable)."},
    },
)
async def ai_grading_webhook(payload: AIGradingWebhookPayload) -> RemediationInstruction:
    """
    Receive an **AI Vision grading result** and return a structured remediation
    instruction telling the frontend which mastery question to load next.

    **Workflow**

    1. Validate the incoming payload (student_id + failed_concept_code).
    2. Look up the *immediate HARD prerequisite* of the failed concept in the
       knowledge graph.
    3. Return a ``RemediationInstruction`` containing:
       - The prerequisite's ``concept_code`` (so the frontend can navigate).
       - The prerequisite's ``mastery_question`` (to render immediately).
       - An ``action`` string the frontend can switch on.

    **Example request body**

    ```json
    {
      "student_id": "stu_42",
      "failed_concept_code": "G9_ALG_QUAD_EQ"
    }
    ```

    **Example response**

    ```json
    {
      "student_id": "stu_42",
      "failed_concept_code": "G9_ALG_QUAD_EQ",
      "action": "LOAD_PREREQUISITE_QUESTION",
      "prerequisite_concept_code": "G8_ALG_LINEAR_EQ",
      "mastery_question": "Giải phương trình: 2x + 5 = 13",
      "message": "Student stu_42 failed G9_ALG_QUAD_EQ. Load prerequisite mastery question for G8_ALG_LINEAR_EQ."
    }
    ```

    **Edge cases**

    - If the failed concept is **foundational** (no hard prerequisites),
      ``action`` is ``"NO_PREREQUISITE_FOUND"`` and ``mastery_question`` is
      ``null`` — the frontend should re-surface the concept itself.
    - If the prerequisite node exists but has no ``mastery_question`` authored
      yet, ``mastery_question`` is ``null`` and the frontend should show the
      concept description instead.

    **Security note**: This endpoint should be protected by a shared secret
    (e.g. ``Authorization: Bearer <WEBHOOK_SECRET>``) before production
    deployment.  CORS is intentionally open in development.
    """
    student_id = payload.student_id.strip()
    failed_code = _normalise_code(payload.failed_concept_code)

    logger.info(
        "Webhook received: student_id='%s', failed_concept_code='%s'.",
        student_id,
        failed_code,
    )

    try:
        prereq_node = get_immediate_prerequisite(failed_code, hard_only=True)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        )
    except LookupError as exc:
        # The failed_concept_code itself doesn't exist in the graph.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except RuntimeError as exc:
        logger.exception(
            "DB error in /webhook/ai-grading-result for '%s'.", failed_code
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        )

    if prereq_node is None:
        # The concept is foundational — no hard prerequisites exist.
        logger.info(
            "No hard prerequisite found for '%s'. Concept is foundational.",
            failed_code,
        )
        return RemediationInstruction(
            student_id=student_id,
            failed_concept_code=failed_code,
            action="NO_PREREQUISITE_FOUND",
            prerequisite_concept_code=None,
            mastery_question=None,
            message=(
                f"Concept '{failed_code}' has no hard prerequisites. "
                "This is a foundational concept. Review the concept itself."
            ),
        )

    logger.info(
        "Remediation: student '%s' → load mastery question for prerequisite '%s'.",
        student_id,
        prereq_node.concept_code,
    )

    return RemediationInstruction(
        student_id=student_id,
        failed_concept_code=failed_code,
        action="LOAD_PREREQUISITE_QUESTION",
        prerequisite_concept_code=prereq_node.concept_code,
        mastery_question=prereq_node.mastery_question,
        message=(
            f"Student '{student_id}' failed '{failed_code}'. "
            f"Load prerequisite mastery question for '{prereq_node.concept_code}'."
        ),
    )


# ---------------------------------------------------------------------------
# AI Diagnostic Matcher
# ---------------------------------------------------------------------------


@app.post(
    "/diagnose-gap",
    tags=["AI Diagnostics"],
    summary="Match a student mistake to a knowledge graph concept and fetch the prerequisite chain.",
    response_model=DiagnosticResponse,
    status_code=status.HTTP_200_OK,
    responses={
        200: {"description": "Diagnostic completed successfully."},
        500: {"description": "Error reaching the Gemini API or database."},
    },
)
async def diagnose_gap(request: DiagnosticRequest) -> DiagnosticResponse:
    """
    Uses the Gemini API to match a described student mistake directly to the closest
    foundational concept in the knowledge graph. Once identified, it retrieves the
    full prerequisite chain for remediation.
    """
    logger.info("Diagnostics requested for concept: %s", request.target_concept_code)
    
    try:
        match_result = await match_error_to_concept(
            problem=request.problem_statement,
            student_mistake=request.student_mistake_description,
            target_concept_code=request.target_concept_code or ""
        )
    except Exception as exc:
        logger.exception("Error calling Gemini API")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate diagnostics: {str(exc)}"
        )
        
    matched_code = match_result.get("matched_concept_code")
    thinking_log = match_result.get("thinking_log")
    explanation = match_result.get("explanation", "")
    
    prerequisite_chain = None
    if matched_code:
        try:
            # We fetch the chain for the matched concept
            prerequisite_chain = get_prerequisite_chain(matched_code)
        except LookupError:
            # Code returned by model does not exist. We just return what we have without a chain.
            logger.warning("Gemini returned a concept code that doesn't exist: %s", matched_code)
        except Exception as exc:
            logger.exception("DB error while fetching prerequisite chain for %s", matched_code)
            
    return DiagnosticResponse(
        matched_concept_code=matched_code,
        thinking_log=thinking_log,
        explanation=explanation,
        prerequisite_chain=prerequisite_chain
    )


# ---------------------------------------------------------------------------
# Internal helpers (not exported)
# ---------------------------------------------------------------------------


def _fetch_node_by_code(concept_code: str) -> Node:
    """
    Fetch a single node by concept_code using the same backend dispatch
    logic as graph_engine (direct psycopg2 or supabase-py table query).

    Raises
    ------
    LookupError  – node not found.
    RuntimeError – database / config failure.
    """
    sql = """
        SELECT id, concept_code, grade_level, topic_category,
               concept_name_vn, concept_description, mastery_question, created_at
        FROM   nodes
        WHERE  concept_code = %(concept_code)s
        LIMIT  1;
    """

    if os.environ.get("DIRECT_DB_URL"):
        from backend.graph_engine import _execute_cte_direct  # type: ignore

        rows = _execute_cte_direct(sql, {"concept_code": concept_code})
    else:
        from backend.graph_engine import _get_supabase_client  # type: ignore

        client = _get_supabase_client()
        resp = (
            client.table("nodes")
            .select("*")
            .eq("concept_code", concept_code)
            .limit(1)
            .execute()
        )
        rows = resp.data or []

    if not rows:
        raise LookupError(
            f"Node with concept_code='{concept_code}' was not found."
        )

    return Node.model_validate(rows[0])
