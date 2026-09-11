"""
Which model turns a summary into entities and relationships.

Three adapters behind one switch (`DRYMEM_EXTRACTOR`):

  ollama     the default — a local model, nothing leaves the network
  fake       deterministic and instant, for CI: no model, no network
  anthropic  Haiku 4.5, for a host without a GPU

Extraction is the slow, fallible part of a save. It is also the *optional* part:
a memory with no extracted entities is still retrievable by recency and by text,
whereas a memory that was never written is gone. So a failing extractor
degrades the save, it does not fail it — see `GraphitiMemoryStore.save`.
"""

from __future__ import annotations

from typing import Any

from graphiti_core.cross_encoder.client import CrossEncoderClient
from graphiti_core.cross_encoder.openai_reranker_client import OpenAIRerankerClient
from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig
from graphiti_core.llm_client.client import LLMClient
from graphiti_core.llm_client.config import LLMConfig
from graphiti_core.llm_client.openai_generic_client import OpenAIGenericClient

from drymem_server.settings import settings

OLLAMA = "ollama"
FAKE = "fake"
ANTHROPIC = "anthropic"


def _empty_for(response_model: Any) -> dict[str, Any]:
    """An empty value for every field, so Graphiti's parsing succeeds cleanly."""
    if response_model is None:
        return {}
    empty: dict[str, Any] = {}
    for name, field in response_model.model_fields.items():
        annotation = str(field.annotation).lower()
        if "list" in annotation:
            empty[name] = []
        elif "dict" in annotation:
            empty[name] = {}
        elif "bool" in annotation:
            empty[name] = False
        elif "int" in annotation or "float" in annotation:
            empty[name] = 0
        elif "str" in annotation:
            empty[name] = ""
        else:
            empty[name] = None
    return empty


class StubLLMClient(LLMClient):
    """An LLM client that extracts nothing, quickly.

    Graphiti drives extraction through its own prompts and response models, so
    the honest way to test the rest of the pipeline without a GPU is to answer
    every prompt with an empty result. Episodes are still written to Neo4j and
    are still retrievable — which is exactly the degraded path we promise when a
    real extractor is unavailable, so CI exercises it on every run.
    """

    def __init__(self) -> None:
        # The base class wants an LLMConfig; nothing in it is ever used here.
        super().__init__(config=LLMConfig(api_key="not-needed", model="stub"), cache=False)
        self.calls = 0

    async def _generate_response(
        self,
        messages: Any,
        response_model: Any = None,
        max_tokens: int = 16384,
        model_size: Any = None,
    ) -> dict[str, Any]:
        """The abstract hook Graphiti calls. Answers every prompt with nothing."""
        self.calls += 1
        return _empty_for(response_model)

    async def generate_response(
        self,
        messages: Any,
        response_model: Any = None,
        max_tokens: int | None = None,
        model_size: Any = None,
        group_id: str | None = None,
        prompt_name: str | None = None,
    ) -> dict[str, Any]:
        """Bypass the base class's prompt assembly — there is no model to prompt."""
        return await self._generate_response(messages, response_model, model_size=model_size)

    def set_tracer(self, tracer: Any) -> None:
        return None


def _openai_compatible(base_url: str, model: str, api_key: str) -> LLMClient:
    return OpenAIGenericClient(
        config=LLMConfig(api_key=api_key, model=model, small_model=model, base_url=base_url)
    )


def build_llm_client(kind: str | None = None) -> LLMClient:
    """The LLM client Graphiti should use for extraction."""
    kind = (kind or settings.drymem_extractor).lower()

    if kind == FAKE:
        return StubLLMClient()

    if kind == ANTHROPIC:
        if not settings.anthropic_api_key:
            raise ValueError(
                "DRYMEM_EXTRACTOR=anthropic needs ANTHROPIC_API_KEY. "
                "Set it, or use the local extractor (DRYMEM_EXTRACTOR=ollama)."
            )
        # Anthropic serves an OpenAI-compatible endpoint, which is what
        # Graphiti's generic client speaks.
        return _openai_compatible(
            "https://api.anthropic.com/v1/",
            settings.anthropic_model,
            settings.anthropic_api_key,
        )

    if kind != OLLAMA:
        raise ValueError(
            f"Unknown DRYMEM_EXTRACTOR {kind!r}. Use one of: {OLLAMA}, {FAKE}, {ANTHROPIC}."
        )

    return _openai_compatible(settings.local_llm_url, settings.local_llm_model, "not-needed")


def build_embedder(kind: str | None = None) -> OpenAIEmbedder:
    """Embeddings always come from the local server; only extraction is switchable.

    Graphiti needs embeddings even when nothing is extracted, and the local
    embedding model is small enough to run anywhere the server runs.
    """
    return OpenAIEmbedder(
        config=OpenAIEmbedderConfig(
            api_key="not-needed",
            embedding_model=settings.embedding_model,
            embedding_dim=settings.embedding_dim,
            base_url=settings.local_llm_url,
        )
    )


def build_cross_encoder(kind: str | None = None) -> CrossEncoderClient:
    """The reranker, pinned to the local endpoint.

    Graphiti defaults this to `OpenAIRerankerClient()` with a bare config — no
    base_url, so it points at api.openai.com and requires OPENAI_API_KEY. Two
    problems with letting that default stand:

    1. The server will not start without an OpenAI key, which is absurd for a
       deployment whose whole point is that no model call leaves the network.
    2. Today's default search recipe reranks with RRF (pure maths, no model), so
       nothing is sent anywhere — but a future recipe that does use the cross
       encoder would start shipping passage text to OpenAI silently.

    Pointing it at the same local server closes both.
    """
    kind = (kind or settings.drymem_extractor).lower()
    base_url = settings.local_llm_url
    model = settings.local_llm_model

    if kind == ANTHROPIC and settings.anthropic_api_key:
        # Anthropic has no logprobs endpoint for reranking, so stay local here.
        pass

    return OpenAIRerankerClient(
        config=LLMConfig(api_key="not-needed", model=model, base_url=base_url)
    )
