"""
Secret redaction, applied to every memory before it is stored or extracted.

This is the first point where a memory can leave the machine that wrote it. An
agent summarising its own session will sometimes quote a config file, and a
stored secret is worse than a lost memory: it is searchable, shared on
promotion, and fed back into future prompts.

Two behaviours, deliberately different:

- Most matches are **redacted** and the save continues. A truncated key is
  useless, and blocking the write would teach people to stop saving.
- A **private key block fails the save** with an error the author sees. That is
  an incident: the key has to be rotated, and silently swallowing it means
  nobody ever finds out.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

PRIVATE_KEY = re.compile(
    r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----", re.IGNORECASE
)

# (kind, pattern). Order matters: specific vendor formats before generic ones.
PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("aws-key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("anthropic-key", re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{20,}")),
    ("openai-key", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_\-]{32,}")),
    ("github-token", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b")),
    ("github-pat", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{40,}\b")),
    ("slack-token", re.compile(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}")),
    ("stripe-key", re.compile(r"\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b")),
    ("google-key", re.compile(r"\bAIza[0-9A-Za-z_\-]{30,40}\b")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]+")),
    (
        "aws-secret",
        re.compile(r"(?i)\baws_secret_access_key\s*[=:]\s*[\"']?([A-Za-z0-9/+=]{40})[\"']?"),
    ),
    # Generic assignments. Requires a quote or 8+ non-space chars so that prose
    # like "the password was wrong" is left alone.
    (
        "credential",
        re.compile(
            # A prefix is allowed because `DATABASE_PASSWORD` has no word
            # boundary before `PASSWORD` — `_` is a word character.
            r"(?i)\b[A-Za-z0-9_]*"
            r"(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b"
            r"\s*[=:]\s*"
            # Don't re-redact a vendor match: `API_KEY=[redacted:anthropic-key]`
            # must keep saying *which* key leaked, so the author knows what to rotate.
            r"(?!\[redacted:)"
            r"(?:\"[^\"\n]{4,}\"|'[^'\n]{4,}'|[^\s\"',;]{8,})"
        ),
    ),
]


class PrivateKeyFound(ValueError):
    """A private key block reached the scrubber. The save is refused."""


@dataclass
class ScrubResult:
    text: str
    redactions: dict[str, int] = field(default_factory=dict)

    @property
    def clean(self) -> bool:
        return not self.redactions

    def summary(self) -> str:
        if self.clean:
            return ""
        parts = [f"{n}x {kind}" for kind, n in sorted(self.redactions.items())]
        return "redacted " + ", ".join(parts)


def _denylist_pattern(literals: list[str]) -> re.Pattern[str] | None:
    cleaned = [re.escape(x.strip()) for x in literals if x.strip()]
    if not cleaned:
        return None
    return re.compile("|".join(cleaned), re.IGNORECASE)


def scrub(text: str, denylist: list[str] | None = None) -> ScrubResult:
    """Redact secrets. Raises PrivateKeyFound if a private key block is present."""
    if not text:
        return ScrubResult(text=text)

    if PRIVATE_KEY.search(text):
        raise PrivateKeyFound(
            "A private key block was found in this memory. Nothing was saved. "
            "Rotate the key, then save again without it."
        )

    counts: dict[str, int] = {}

    def replace(kind: str):
        def _sub(match: re.Match[str]) -> str:
            counts[kind] = counts.get(kind, 0) + 1
            return f"[redacted:{kind}]"

        return _sub

    for kind, pattern in PATTERNS:
        text = pattern.sub(replace(kind), text)

    extra = _denylist_pattern(denylist or [])
    if extra is not None:
        text = extra.sub(replace("denylisted"), text)

    return ScrubResult(text=text, redactions=counts)
