"""HTTP surface. The five memory operations, plus projects and health."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query, status

from drymem_server.api.deps import PrincipalDep, ServiceDep, SessionDep, get_store
from drymem_server.api.schemas import (
    ClusterOut,
    ContextResponse,
    DeleteResponse,
    DiscoverResponse,
    DistillRequest,
    DistillResponse,
    EpisodeOut,
    FactOut,
    FeedbackRequest,
    FeedbackResponse,
    HealthResponse,
    MemberOut,
    MemberRequest,
    MembersResponse,
    MemorySchemaResponse,
    MemoryTypeOut,
    ProjectOut,
    ProjectsResponse,
    PromoteResponse,
    PublishSkillRequest,
    SaveMemoryRequest,
    SaveMemoryResponse,
    SearchResponse,
    SessionOut,
    SessionsResponse,
    SkillOut,
    SkillsResponse,
    TopicsResponse,
    UpdateMemoryRequest,
    UserOut,
    UsersResponse,
)
from drymem_server.schema import MEMORY_TYPES, SECTIONS, TEMPLATE
from drymem_server.scrubber import PrivateKeyFound
from drymem_server.service import MemoryService
from drymem_server.settings import settings

logger = logging.getLogger(__name__)
router = APIRouter()


def _saved_response(saved, project_key: str, author: str, name: str) -> SaveMemoryResponse:
    return SaveMemoryResponse(
        id=str(saved.row.id),
        episode_uuid=saved.episode_uuid,
        name=name,
        project_key=project_key,
        author=author,
        entity_count=saved.entity_count,
        relationship_count=saved.edge_count,
        scrubbed=saved.scrub.summary(),
        degraded=saved.degraded,
    )


@router.post("/v1/memories", response_model=SaveMemoryResponse, tags=["memories"])
async def save_memory(body: SaveMemoryRequest, service: ServiceDep) -> SaveMemoryResponse:
    """Save a session summary. Returns 422 if it contains a private key."""
    name = body.topic_key or f"session-{MemoryService.timestamp()}"
    try:
        saved = await service.save(
            project_key=body.project_key,
            body=body.summary,
            name=name,
            tool=body.tool,
            topic_key=body.topic_key or None,
            memory_type=body.type,
            session_id=body.session_id or None,
        )
    except PrivateKeyFound as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    return _saved_response(saved, body.project_key, service.principal.email, name)


@router.patch("/v1/memories/{topic_key:path}", response_model=SaveMemoryResponse, tags=["memories"])
async def update_memory(
    topic_key: str, body: UpdateMemoryRequest, service: ServiceDep
) -> SaveMemoryResponse:
    """Append to a topic, or replace it.

    Appending is the default because Graphiti reconciles contradictions itself:
    the older fact is marked superseded rather than lost, which keeps the history
    of a decision readable.
    """
    matching = await service.episodes_for_topic(project_key=body.project_key, topic_key=topic_key)
    if body.replace:
        for episode in matching:
            await service.delete(episode_uuid=episode.uuid)

    name = topic_key if body.replace else f"{topic_key}/update-{MemoryService.timestamp()}"
    try:
        saved = await service.save(
            project_key=body.project_key,
            body=body.update_summary,
            name=name,
            tool=body.tool,
            topic_key=topic_key,
            memory_type=body.type,
            session_id=body.session_id or None,
        )
    except PrivateKeyFound as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    return _saved_response(saved, body.project_key, service.principal.email, name)


@router.get("/v1/memories/search", response_model=SearchResponse, tags=["memories"])
async def search_memories(
    service: ServiceDep,
    project_key: str = Query(...),
    q: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=100),
) -> SearchResponse:
    facts = await service.search(project_key=project_key, query=q, limit=limit)
    return SearchResponse(
        query=q,
        project_key=project_key,
        results=[
            FactOut(name=f.name, fact=f.fact, created_at=f.created_at, superseded=f.superseded)
            for f in facts
        ],
    )


@router.get("/v1/memories/context", response_model=ContextResponse, tags=["memories"])
async def memory_context(
    service: ServiceDep,
    project_key: str = Query(...),
    limit: int = Query(10, ge=1, le=100),
) -> ContextResponse:
    entries = await service.entries(project_key=project_key, limit=limit)
    return ContextResponse(
        project_key=project_key,
        episodes=[
            EpisodeOut(
                uuid=entry.episode.uuid,
                name=entry.episode.name,
                content=entry.episode.content,
                created_at=entry.episode.created_at,
                author=entry.episode.metadata.author if entry.episode.metadata else None,
                scope=entry.episode.metadata.scope if entry.episode.metadata else "private",
                title=entry.title or entry.episode.name,
                type=entry.memory_type,
                session_id=entry.session_id,
                topic_key=entry.topic_key,
                promoted_at=entry.promoted_at,
                rating=entry.rating,
            )
            for entry in entries
        ],
    )


@router.get("/v1/memories/topics", response_model=TopicsResponse, tags=["memories"])
async def list_topics(service: ServiceDep, project_key: str = Query(...)) -> TopicsResponse:
    """Every topic key already stored. Used by `drymem import` to stay idempotent."""
    return TopicsResponse(
        project_key=project_key, topic_keys=await service.topic_keys(project_key=project_key)
    )


@router.delete("/v1/memories/{episode_uuid}", response_model=DeleteResponse, tags=["memories"])
async def delete_memory(episode_uuid: str, service: ServiceDep) -> DeleteResponse:
    """Delete a memory. A uuid outside the caller's org is simply not found."""
    if not await service.delete(episode_uuid=episode_uuid):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such memory.")
    return DeleteResponse(episode_uuid=episode_uuid, deleted=True)


@router.post(
    "/v1/memories/{episode_uuid}/feedback", response_model=FeedbackResponse, tags=["memories"]
)
async def rate_memory(
    episode_uuid: str, body: FeedbackRequest, service: ServiceDep
) -> FeedbackResponse:
    """Record whether a retrieved memory was useful.

    This is the pilot's precision metric: PLAN.md's 90% bar is measured from
    these rows, so the query that surfaced the memory is stored alongside the
    thumb — a rating with no query cannot be learned from.
    """
    if body.rating not in (1, -1):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "rating must be 1 or -1.")
    if not await service.rate(episode_uuid=episode_uuid, rating=body.rating, query=body.query):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such memory.")
    return FeedbackResponse(episode_uuid=episode_uuid, rating=body.rating, query=body.query)


@router.post(
    "/v1/memories/{episode_uuid}/promote", response_model=PromoteResponse, tags=["memories"]
)
async def promote_memory(episode_uuid: str, service: ServiceDep) -> PromoteResponse:
    """Share a memory with the project's members.

    Only your own memory, and only into a project you belong to. Promoting an
    already-promoted memory succeeds without duplicating it, so a retry is safe.
    """
    memory = await service.promote(episode_uuid=episode_uuid)
    if memory is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such memory.")
    return PromoteResponse(
        episode_uuid=episode_uuid, scope=memory.scope, promoted_at=memory.promoted_at
    )


@router.get(
    "/v1/projects/{project_key:path}/members", response_model=MembersResponse, tags=["projects"]
)
async def list_members(project_key: str, service: ServiceDep) -> MembersResponse:
    members = await service.members(project_key=project_key)
    if members is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such project.")
    return MembersResponse(
        project_key=project_key,
        members=[MemberOut(user_id=str(u.id), email=u.email, role=r) for u, r in members],
    )


@router.post(
    "/v1/projects/{project_key:path}/members", response_model=MembersResponse, tags=["projects"]
)
async def add_member(project_key: str, body: MemberRequest, service: ServiceDep) -> MembersResponse:
    """Add someone to a project. They see its team memories, never its private ones."""
    members = await service.add_member(project_key=project_key, email=body.email)
    if members is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "No such project, or no such user in this org."
        )
    return MembersResponse(
        project_key=project_key,
        members=[MemberOut(user_id=str(u.id), email=u.email, role=r) for u, r in members],
    )


@router.get("/v1/skills/discover", response_model=DiscoverResponse, tags=["skills"])
async def discover_skills(
    service: ServiceDep,
    project_key: str = Query(...),
    min_memories: int = Query(2, ge=1, le=50),
) -> DiscoverResponse:
    """Subjects the team's memories keep returning to.

    Which of them lack a skill is decided by the client, which is the only side
    that knows what is installed on this machine.
    """
    clusters = await service.discover(project_key=project_key, min_memories=min_memories)
    return DiscoverResponse(project_key=project_key, clusters=[ClusterOut(**c) for c in clusters])


@router.post("/v1/skills/distill", response_model=DistillResponse, tags=["skills"])
async def distill_skill(body: DistillRequest, service: ServiceDep) -> DistillResponse:
    """Draft a SKILL.md from the memories about a subject.

    The result is a draft for a person to review, never something installed
    automatically: a skill changes how every agent on the team behaves.
    """
    try:
        draft = await service.distill(project_key=body.project_key, topic=body.topic)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    if draft is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, f"No memories about {body.topic!r} to write from."
        )
    return DistillResponse(
        topic=draft.topic,
        name=draft.name,
        content=draft.content,
        model=draft.model,
        memory_count=draft.memory_count,
    )


@router.get("/v1/projects", response_model=ProjectsResponse, tags=["projects"])
async def list_projects(service: ServiceDep) -> ProjectsResponse:
    return ProjectsResponse(
        projects=[
            ProjectOut(
                id=str(p.id),
                project_key=p.project_key,
                display_name=p.display_name,
                memory_count=count,
                positive=positive,
                negative=negative,
            )
            for p, count, positive, negative in await service.projects()
        ]
    )


@router.get("/v1/memories/schema", response_model=MemorySchemaResponse, tags=["memories"])
async def memory_schema(_: PrincipalDep) -> MemorySchemaResponse:
    """What a well-written memory looks like.

    Served rather than duplicated in each client: the UI, the CLI and any future
    editor plugin all need the same list, and three hand-copied lists drift.
    """
    return MemorySchemaResponse(
        types=[MemoryTypeOut(name=k, description=v) for k, v in MEMORY_TYPES.items()],
        sections=list(SECTIONS),
        template=TEMPLATE,
    )


@router.get("/v1/sessions", response_model=SessionsResponse, tags=["sessions"])
async def list_sessions(
    service: ServiceDep,
    project_key: str = Query(...),
    limit: int = Query(50, ge=1, le=200),
) -> SessionsResponse:
    """The sittings this project's memories came out of."""
    sessions = await service.sessions(project_key=project_key, limit=limit)
    return SessionsResponse(
        project_key=project_key,
        sessions=[
            SessionOut(
                session_id=s.session_id,
                author=s.author,
                memory_count=s.memory_count,
                shared=s.shared,
                started_at=s.started_at,
                ended_at=s.ended_at,
                titles=s.titles,
                synthetic=s.synthetic,
            )
            for s in sessions
        ],
    )


@router.get("/v1/users", response_model=UsersResponse, tags=["users"])
async def list_users(service: ServiceDep) -> UsersResponse:
    """Everyone in this org, with counts only — never anyone's memories."""
    return UsersResponse(
        users=[
            UserOut(
                id=str(u.id),
                email=u.email,
                name=u.name,
                memory_count=memories,
                project_count=projects,
                created_at=u.created_at,
            )
            for u, memories, projects in await service.org_users()
        ]
    )


def _skill_out(skill, author: str) -> SkillOut:
    return SkillOut(
        id=str(skill.id),
        name=skill.name,
        topic=skill.topic,
        content=skill.content,
        author=author,
        model=skill.model,
        memory_count=skill.memory_count,
        updated_at=skill.updated_at,
    )


@router.get("/v1/skills", response_model=SkillsResponse, tags=["skills"])
async def list_skills(service: ServiceDep, project_key: str = Query(...)) -> SkillsResponse:
    """Skills this project has published."""
    return SkillsResponse(
        project_key=project_key,
        skills=[_skill_out(s, email) for s, email in await service.skills(project_key=project_key)],
    )


@router.post("/v1/skills", response_model=SkillOut, tags=["skills"])
async def publish_skill(body: PublishSkillRequest, service: ServiceDep) -> SkillOut:
    """Publish a reviewed draft to the project. Publishing twice replaces it."""
    skill = await service.publish_skill(
        project_key=body.project_key,
        name=body.name,
        topic=body.topic,
        content=body.content,
        model=body.model,
        memory_count=body.memory_count,
    )
    if skill is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such project.")
    return _skill_out(skill, service.principal.email)


@router.delete("/v1/skills/{name}", response_model=DeleteResponse, tags=["skills"])
async def delete_skill(
    name: str, service: ServiceDep, project_key: str = Query(...)
) -> DeleteResponse:
    if not await service.delete_skill(project_key=project_key, name=name):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such skill.")
    return DeleteResponse(episode_uuid=name, deleted=True)


@router.get("/healthz", response_model=HealthResponse, tags=["ops"])
async def healthz(session: SessionDep) -> HealthResponse:
    """Liveness for both stores. Unauthenticated on purpose — it reveals nothing."""
    from sqlalchemy import text

    postgres = neo4j = False
    try:
        await session.execute(text("SELECT 1"))
        postgres = True
    except Exception as exc:  # noqa: BLE001 - health reports, it never raises
        logger.warning("healthz: postgres unreachable: %s", exc)

    try:
        await get_store().recent(group_ids=["__healthz__"], limit=1)
        neo4j = True
    except Exception as exc:  # noqa: BLE001
        logger.warning("healthz: neo4j unreachable: %s", exc)

    return HealthResponse(
        status="ok" if (postgres and neo4j) else "degraded",
        postgres=postgres,
        neo4j=neo4j,
        extractor=settings.drymem_extractor,
    )


__all__ = ["PrincipalDep", "router"]
