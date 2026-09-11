"""
Request and response models.

These are the contract: `packages/api-types` is generated from the OpenAPI
schema they produce, so the TypeScript client cannot drift from them silently.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class SaveMemoryRequest(BaseModel):
    project_key: str = Field(
        ..., description="Normalised git remote, e.g. github.com/acme/payments"
    )
    summary: str = Field(..., min_length=1, description="Markdown body written by the agent")
    topic_key: str = Field("", description="Stable key for cross-session linking")
    tool: str = Field("claude-code", description="Which agent produced this")


class UpdateMemoryRequest(BaseModel):
    project_key: str
    update_summary: str = Field(..., min_length=1)
    replace: bool = Field(False, description="Delete prior episodes for this topic first")
    tool: str = "claude-code"


class SaveMemoryResponse(BaseModel):
    id: str
    episode_uuid: str
    name: str
    project_key: str
    author: str
    entity_count: int
    relationship_count: int
    scrubbed: str = Field("", description="What was redacted, empty if nothing")
    degraded: str | None = Field(
        None, description="Set when extraction failed and only the episode was stored"
    )


class FactOut(BaseModel):
    name: str
    fact: str
    created_at: datetime | None = None
    superseded: bool = False


class SearchResponse(BaseModel):
    query: str
    project_key: str
    results: list[FactOut]


class EpisodeOut(BaseModel):
    uuid: str
    name: str
    content: str
    created_at: datetime | None = None
    author: str | None = None
    scope: str = "private"


class ContextResponse(BaseModel):
    project_key: str
    episodes: list[EpisodeOut]


class DeleteResponse(BaseModel):
    episode_uuid: str
    deleted: bool


class ProjectOut(BaseModel):
    id: str
    project_key: str
    display_name: str | None = None
    memory_count: int = 0


class ProjectsResponse(BaseModel):
    projects: list[ProjectOut]


class HealthResponse(BaseModel):
    status: str
    postgres: bool
    neo4j: bool
    extractor: str
