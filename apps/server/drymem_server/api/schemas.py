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


class TopicsResponse(BaseModel):
    project_key: str
    topic_keys: list[str]


class DeleteResponse(BaseModel):
    episode_uuid: str
    deleted: bool


class FeedbackRequest(BaseModel):
    rating: int = Field(..., description="+1 or -1")
    query: str = Field(
        "",
        max_length=500,
        description=(
            "The search that surfaced this memory. A rating without it says "
            "'this memory is bad'; with it, 'this memory is a bad answer to X'."
        ),
    )


class FeedbackResponse(BaseModel):
    episode_uuid: str
    rating: int
    query: str


class PromoteResponse(BaseModel):
    episode_uuid: str
    scope: str
    promoted_at: datetime | None = None


class MemberRequest(BaseModel):
    email: str = Field(..., description="An existing user in this org")


class MemberOut(BaseModel):
    user_id: str
    email: str
    role: str


class MembersResponse(BaseModel):
    project_key: str
    members: list[MemberOut]


class ProjectOut(BaseModel):
    id: str
    project_key: str
    display_name: str | None = None
    memory_count: int = 0
    positive: int = 0
    negative: int = 0


class ProjectsResponse(BaseModel):
    projects: list[ProjectOut]


class ClusterOut(BaseModel):
    topic: str
    memory_count: int
    facts: list[str] = []


class DiscoverResponse(BaseModel):
    project_key: str
    clusters: list[ClusterOut]


class DistillRequest(BaseModel):
    project_key: str
    topic: str = Field(..., min_length=1)


class DistillResponse(BaseModel):
    topic: str
    name: str
    content: str
    model: str
    memory_count: int


class HealthResponse(BaseModel):
    status: str
    postgres: bool
    neo4j: bool
    extractor: str
