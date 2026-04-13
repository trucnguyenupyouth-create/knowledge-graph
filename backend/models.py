"""
backend/models.py

Pydantic v2 models for the Math Knowledge Graph.

Design decisions:
- BaseModel subclasses use `model_config = ConfigDict(from_attributes=True)`
  so they work seamlessly with SQLAlchemy ORM objects as well as raw dicts
  returned by Supabase's `postgrest-py` client.
- "Create" variants omit server-generated fields (id, created_at) so they
  cannot be accidentally supplied by the client.
- Strict validators enforce business rules that mirror the SQL CHECK constraints,
  giving early, descriptive errors before a round-trip to the database.
- All string fields are stripped of surrounding whitespace on ingestion.
"""

from __future__ import annotations

import re
from datetime import datetime
from enum import Enum
from typing import Annotated, Optional
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


# ---------------------------------------------------------------------------
# Shared type aliases
# ---------------------------------------------------------------------------

# concept_code must follow a strict pattern: GRADE_CATEGORY_TOPIC
# e.g.  "G6_FRAC_ADD", "G10_ALG_POLY_DIV"
# Allowed chars: uppercase letters, digits, underscores; 3–64 characters.
_CONCEPT_CODE_PATTERN = re.compile(r"^[A-Z0-9_]{3,64}$")

ConceptCode = Annotated[
    str,
    Field(
        min_length=3,
        max_length=64,
        examples=["G6_FRAC_ADD", "G10_ALG_POLY_DIV"],
        description=(
            "Curriculum-stable concept identifier. "
            "Only uppercase letters, digits, and underscores are allowed "
            "(e.g. 'G6_FRAC_ADD')."
        ),
    ),
]


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------


class RelationshipType(str, Enum):
    """
    The type of prerequisite relationship between two knowledge-graph nodes.

    HARD_PREREQUISITE
        The student cannot meaningfully engage with the target concept until
        the source concept is fully mastered.  The adaptive engine uses this
        edge to *block* progression.

    SOFT_PREREQUISITE
        Mastery of the source concept is strongly recommended but not strictly
        required.  The adaptive engine uses this edge to *prioritise* review
        suggestions.
    """

    HARD_PREREQUISITE = "HARD_PREREQUISITE"
    SOFT_PREREQUISITE = "SOFT_PREREQUISITE"


# ---------------------------------------------------------------------------
# Node models
# ---------------------------------------------------------------------------


class NodeCreate(BaseModel):
    """
    Payload accepted when creating a new knowledge-graph node.

    All fields that the database populates automatically (id, created_at)
    are purposefully absent to prevent accidental client overrides.
    """

    model_config = ConfigDict(from_attributes=True, str_strip_whitespace=True)

    concept_code: ConceptCode = Field(
        ...,
        description=(
            "Unique, human-readable concept identifier used for curriculum "
            "mapping (e.g. 'G6_FRAC_ADD').  Must match ^[A-Z0-9_]{3,64}$."
        ),
    )
    grade_level: int = Field(
        ...,
        ge=1,
        le=12,
        description="National curriculum grade level (1–12 inclusive).",
        examples=[6],
    )
    topic_category: str = Field(
        ...,
        min_length=1,
        max_length=128,
        description=(
            "Broad curriculum category, e.g. 'Số học', 'Đại số', 'Hình học', "
            "'Thống kê & Xác suất'."
        ),
        examples=["Số học"],
    )
    concept_name_vn: str = Field(
        ...,
        min_length=1,
        max_length=256,
        description=(
            "Official Vietnamese name of the concept as defined by the "
            "national curriculum."
        ),
        examples=["Phân số"],
    )
    concept_description: Optional[str] = Field(
        default=None,
        description=(
            "Full description including scope, learning objectives, and "
            "key sub-skills.  May be NULL for newly seeded concepts."
        ),
    )
    mastery_question: Optional[str] = Field(
        default=None,
        description=(
            "A single diagnostic question that is sufficient to gate mastery "
            "of this concept.  May be NULL when not yet authored."
        ),
    )

    @field_validator("concept_code")
    @classmethod
    def validate_concept_code_format(cls, value: str) -> str:
        """Enforce the ^[A-Z0-9_]{3,64}$ pattern on concept_code."""
        if not _CONCEPT_CODE_PATTERN.match(value):
            raise ValueError(
                f"concept_code '{value}' is invalid. "
                "Only uppercase letters (A–Z), digits (0–9), and underscores "
                "(_) are permitted, with a length of 3–64 characters."
            )
        return value


class Node(NodeCreate):
    """
    Full node representation returned from the database.

    Extends NodeCreate with the server-generated fields id and created_at.
    """

    id: UUID = Field(
        ...,
        description="Globally unique node identifier (UUID v4, server-generated).",
    )
    created_at: datetime = Field(
        ...,
        description="UTC timestamp of when this node was inserted (server-generated).",
    )

    model_config = ConfigDict(from_attributes=True, str_strip_whitespace=True)


# ---------------------------------------------------------------------------
# Edge models
# ---------------------------------------------------------------------------


class EdgeCreate(BaseModel):
    """
    Payload accepted when creating a new prerequisite edge.

    The client must supply both node UUIDs and the relationship type.
    The database enforces referential integrity (FK) and the no-self-loop /
    uniqueness constraints; Pydantic mirrors the self-loop check here for
    fast, user-friendly error messages.
    """

    model_config = ConfigDict(from_attributes=True, str_strip_whitespace=True)

    target_node_id: UUID = Field(
        ...,
        description=(
            "UUID of the *dependent* concept — the one that REQUIRES the "
            "source to be mastered first."
        ),
    )
    source_node_id: UUID = Field(
        ...,
        description=(
            "UUID of the *prerequisite* concept — the one that MUST be "
            "mastered before the target."
        ),
    )
    relationship_type: RelationshipType = Field(
        ...,
        description=(
            "HARD_PREREQUISITE (strictly blocking) or "
            "SOFT_PREREQUISITE (strongly recommended)."
        ),
        examples=[RelationshipType.HARD_PREREQUISITE],
    )

    @model_validator(mode="after")
    def validate_no_self_loop(self) -> "EdgeCreate":
        """
        Mirror the SQL CHECK (source_node_id <> target_node_id).

        Raises ValueError with a descriptive message so the API can return
        a 422 before touching the database.
        """
        if self.source_node_id == self.target_node_id:
            raise ValueError(
                "source_node_id and target_node_id must be different. "
                f"A node ('{self.source_node_id}') cannot be its own prerequisite."
            )
        return self


class Edge(EdgeCreate):
    """
    Full edge representation returned from the database.

    Extends EdgeCreate with the server-generated primary key id.
    """

    id: UUID = Field(
        ...,
        description="Globally unique edge identifier (UUID v4, server-generated).",
    )

    model_config = ConfigDict(from_attributes=True, str_strip_whitespace=True)
