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
    type: str = Field(
        "note",
        description=(
            "decision · architecture · bugfix · discovery · convention · note. "
            "An unknown value becomes 'note' rather than failing the save."
        ),
    )
    session_id: str = Field("", description="The agent run this came out of")


class UpdateMemoryRequest(BaseModel):
    project_key: str
    update_summary: str = Field(..., min_length=1)
    replace: bool = Field(False, description="Delete prior episodes for this topic first")
    tool: str = "claude-code"
    type: str = "note"
    session_id: str = ""


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
    # The memories that match. What a person searching actually wants.
    memories: list[EpisodeOut] = []
    # The facts the graph drew out of them, kept as supporting detail.
    results: list[FactOut] = []


class EpisodeOut(BaseModel):
    uuid: str
    name: str
    content: str
    created_at: datetime | None = None
    author: str | None = None
    # The person's name when the org knows one; pages showed a raw email.
    author_name: str = ""
    scope: str = "private"
    # Everything below comes from the index, not the graph. `title` is what a
    # person wrote; `name` is the topic key a machine keys on.
    title: str = ""
    type: str = "note"
    session_id: str = ""
    topic_key: str = ""
    promoted_at: datetime | None = None
    rating: int | None = Field(None, description="+1, -1, or null when unrated")


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


class SessionOut(BaseModel):
    session_id: str
    author: str
    # The person's name when the org knows one; the table showed a raw email.
    author_name: str = ""
    memory_count: int
    shared: int = 0
    started_at: datetime
    ended_at: datetime
    titles: list[str] = []
    synthetic: bool = Field(
        False, description="Grouped by author and day because no session id was recorded"
    )


class SessionMemoryOut(BaseModel):
    uuid: str
    title: str
    type: str = "note"
    scope: str = "private"
    created_at: datetime
    topic_key: str = ""


class SessionDetailResponse(BaseModel):
    project_key: str
    session: SessionOut
    memories: list[SessionMemoryOut] = []


class SessionsResponse(BaseModel):
    project_key: str
    sessions: list[SessionOut]


class UserOut(BaseModel):
    id: str
    email: str
    name: str | None = None
    memory_count: int = 0
    project_count: int = 0
    created_at: datetime | None = None


class UsersResponse(BaseModel):
    users: list[UserOut]


class SkillOut(BaseModel):
    id: str
    name: str
    topic: str
    content: str
    author: str
    model: str | None = None
    memory_count: int = 0
    updated_at: datetime | None = None


class SkillsResponse(BaseModel):
    project_key: str
    skills: list[SkillOut]


class PublishSkillRequest(BaseModel):
    project_key: str
    name: str = Field(..., min_length=1, max_length=200)
    topic: str = Field("", max_length=300)
    content: str = Field(..., min_length=1)
    model: str | None = None
    memory_count: int = 0


class MemoryTypeOut(BaseModel):
    name: str
    description: str


class MemorySchemaResponse(BaseModel):
    """The shape a well-written memory has. Served so clients need no copy of it."""

    types: list[MemoryTypeOut]
    sections: list[str]
    template: str


class MeOut(BaseModel):
    id: str
    email: str
    name: str | None = None
    org_id: str
    created_at: datetime | None = None


class RenameMeRequest(BaseModel):
    name: str = Field("", max_length=200)


class RenameProjectRequest(BaseModel):
    display_name: str = Field("", max_length=200)


class MemberRoleRequest(BaseModel):
    role: str = Field(..., description="member or admin")


class OverviewResponse(BaseModel):
    project_key: str
    memories: int = 0
    shared: int = 0
    sessions: int = 0
    members: int = 0
    skills: int = 0
    positive: int = 0
    negative: int = 0
    by_type: dict[str, int] = {}


class GraphNode(BaseModel):
    id: str
    kind: str = Field(..., description="memory or entity")
    label: str
    type: str = ""
    author: str = ""
    scope: str = ""
    created_at: datetime | None = None
    mentions: int = 0


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    kind: str = Field(..., description="mentions or fact")
    label: str = ""
    superseded: bool = False


class GraphResponse(BaseModel):
    project_key: str
    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []
    truncated: bool = False
    total_memories: int = 0


class TreeDecision(BaseModel):
    id: str
    title: str
    type: str = ""
    author: str = ""
    author_name: str = ""
    created_at: datetime | None = None
    gist: str = ""
    paths: list[str] = []
    superseded_by: str | None = None


class TreeArea(BaseModel):
    id: str
    label: str
    total: int = 0
    decisions: list[TreeDecision] = []
    children: list[TreeArea] = []


class TreeResponse(BaseModel):
    project_key: str
    root: TreeArea
    truncated: bool = False
    total_memories: int = 0
    unplaced: int = 0


class AskTurn(BaseModel):
    role: str
    content: str = Field(..., max_length=4000)


class AskRequest(BaseModel):
    project_key: str
    question: str = Field(..., min_length=3, max_length=500)
    # Earlier turns, so "and why?" means something. Retrieval still runs on the
    # question alone — the history is context for the model, not a search term.
    history: list[AskTurn] = Field(default_factory=list, max_length=20)
    # The memories the last answer stood on. A follow-up can carry no subject of
    # its own — "and what files did he change?" — so the conversation's subject
    # travels as uuids rather than being re-derived from words that lack it.
    carry: list[str] = Field(default_factory=list, max_length=8)


class AskSource(BaseModel):
    index: int
    uuid: str
    title: str
    author: str = ""
    # The person's name when the org knows one, so a card reads "Miguel" and
    # not the local part of whatever address they commit under.
    author_name: str = ""
    created_at: datetime | None = None
    type: str = "note"
    scope: str = "private"


class AskResponse(BaseModel):
    question: str
    answer: str
    model: str
    sources: list[AskSource] = []
    grounded: bool = Field(True, description="False when nothing was found and no model was asked")


class CaptureModeResponse(BaseModel):
    project_key: str
    capture_mode: str


class HealthResponse(BaseModel):
    status: str
    postgres: bool
    neo4j: bool
    extractor: str
