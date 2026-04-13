-- =============================================================================
-- Math Knowledge Graph Schema
-- Platform: Supabase (PostgreSQL 15+)
-- Description: Deterministic knowledge graph storing math concepts (nodes) and
--              their prerequisite relationships (edges).
-- =============================================================================

-- Enable pgcrypto for gen_random_uuid() if not already enabled (Supabase enables
-- this by default; keep as a safety net).
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- -----------------------------------------------------------------------------
-- TABLE: nodes
-- Each row represents a single, atomic math concept in the knowledge graph.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nodes (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Human-readable, curriculum-stable identifier (e.g. "G6_FRAC_ADD").
    -- Must be unique and never NULL so it can be used as a stable foreign key
    -- in external systems without relying on the internal UUID.
    concept_code          VARCHAR(64)   NOT NULL UNIQUE,

    -- School grade level this concept belongs to (e.g. 1–12).
    grade_level           INT           NOT NULL
                              CHECK (grade_level BETWEEN 1 AND 12),

    -- Broad curriculum category (e.g. "Số học", "Đại số", "Hình học").
    topic_category        VARCHAR(128)  NOT NULL,

    -- Official Vietnamese concept name as used in the national curriculum.
    concept_name_vn       VARCHAR(256)  NOT NULL,

    -- Detailed description of the concept, its scope, and learning goals.
    concept_description   TEXT,

    -- A single diagnostic question that validates mastery of this concept.
    mastery_question      TEXT,

    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  nodes                      IS 'Atomic math concepts that form the vertices of the knowledge graph.';
COMMENT ON COLUMN nodes.concept_code         IS 'Stable, human-readable identifier for the concept (e.g. G6_FRAC_ADD). Used for curriculum mapping.';
COMMENT ON COLUMN nodes.grade_level          IS 'National curriculum grade (1–12).';
COMMENT ON COLUMN nodes.topic_category       IS 'Broad topic area, e.g. "Số học", "Đại số", "Hình học", "Thống kê".';
COMMENT ON COLUMN nodes.concept_name_vn      IS 'Official Vietnamese name of the concept as defined by the national curriculum.';
COMMENT ON COLUMN nodes.concept_description  IS 'Full description including scope, learning objectives, and key sub-skills.';
COMMENT ON COLUMN nodes.mastery_question     IS 'A single diagnostic question sufficient to gate mastery of this concept.';


-- -----------------------------------------------------------------------------
-- TABLE: edges
-- Each row represents a directed prerequisite relationship between two concepts.
--
-- Directionality convention:
--   source_node_id → target_node_id
--   meaning "you must master SOURCE before you can learn TARGET".
--
-- In other words:
--   source = prerequisite concept
--   target = dependent concept that requires the source
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edges (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The concept that *depends on* the prerequisite (the "child" in the DAG).
    target_node_id        UUID          NOT NULL
                              REFERENCES nodes(id) ON DELETE CASCADE,

    -- The concept that *must be mastered first* (the "parent" in the DAG).
    source_node_id        UUID          NOT NULL
                              REFERENCES nodes(id) ON DELETE CASCADE,

    -- HARD_PREREQUISITE: student cannot proceed without mastering the source.
    -- SOFT_PREREQUISITE: strongly recommended but not strictly blocking.
    relationship_type     VARCHAR(32)   NOT NULL
                              CHECK (relationship_type IN ('HARD_PREREQUISITE', 'SOFT_PREREQUISITE')),

    -- Integrity constraints --------------------------------------------------

    -- A node cannot be its own prerequisite (no self-loops).
    CONSTRAINT edges_no_self_loop
        CHECK (source_node_id <> target_node_id),

    -- Each (target, source) pair must be unique regardless of relationship type.
    -- This prevents duplicate edges in either direction.
    CONSTRAINT edges_unique_pair
        UNIQUE (target_node_id, source_node_id)
);

COMMENT ON TABLE  edges                      IS 'Directed prerequisite edges between knowledge graph nodes. source → target means "master source before target".';
COMMENT ON COLUMN edges.target_node_id       IS 'The dependent concept (the one that REQUIRES the source to be mastered first).';
COMMENT ON COLUMN edges.source_node_id       IS 'The prerequisite concept (must be mastered BEFORE the target).';
COMMENT ON COLUMN edges.relationship_type    IS 'HARD_PREREQUISITE = strictly blocking; SOFT_PREREQUISITE = strongly recommended.';


-- -----------------------------------------------------------------------------
-- INDEXES
-- Optimised for the most common graph traversal patterns:
--   1. "Find all prerequisites of a concept"  → filter on target_node_id
--   2. "Find all dependents of a concept"     → filter on source_node_id
-- -----------------------------------------------------------------------------

-- Forward traversal: given a target node, find its prerequisites (parent nodes).
CREATE INDEX IF NOT EXISTS idx_edges_target_node_id
    ON edges (target_node_id);

-- Reverse traversal: given a source node, find its dependents (child nodes).
CREATE INDEX IF NOT EXISTS idx_edges_source_node_id
    ON edges (source_node_id);

-- Composite index to accelerate queries that join on both columns simultaneously
-- (e.g. cycle-detection CTEs, path queries).
CREATE INDEX IF NOT EXISTS idx_edges_source_target
    ON edges (source_node_id, target_node_id);

-- Partial index for fetching only hard prerequisites — the most latency-
-- sensitive query path in the adaptive learning engine.
CREATE INDEX IF NOT EXISTS idx_edges_hard_prerequisites
    ON edges (target_node_id, source_node_id)
    WHERE relationship_type = 'HARD_PREREQUISITE';
