"""
Secret redaction, in both directions.

Two failure modes, and the second is the sneaky one:
  - a real secret gets stored  → a searchable, shareable leak
  - innocent prose gets redacted → memories quietly corrupted, and nobody
    notices because the summary still reads fine
"""

from __future__ import annotations

import pytest

from drymem_server.scrubber import PrivateKeyFound, scrub

# Structurally valid, never issued.
SECRETS = [
    ("aws-key", "Set AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE in the env"),
    ("anthropic-key", "export ANTHROPIC_API_KEY=sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"),
    ("openai-key", "key is sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdef"),
    ("github-token", "cloned with ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"),
    ("github-pat", "token github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz0123456789ABCD"),
    ("slack-token", "webhook uses xoxb-123456789012-abcdefghijklmnop"),
    ("stripe-key", "billing key sk_live_AbCdEfGhIjKlMnOpQrStUv"),
    ("google-key", "maps key AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R"),
    (
        "jwt",
        "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123",
    ),
    ("credential", 'DATABASE_PASSWORD="hunter2-correct-horse"'),
    ("credential", "api_key: aVeryLongSecretValueHere123"),
]


@pytest.mark.parametrize("kind,text", SECRETS, ids=[f"{k}-{i}" for i, (k, _) in enumerate(SECRETS)])
def test_secrets_are_redacted(kind, text):
    result = scrub(text)

    assert kind in result.redactions, f"{kind} not detected in {text!r}"
    assert not result.clean
    assert f"[redacted:{kind}]" in result.text


@pytest.mark.parametrize("kind,text", SECRETS, ids=[f"{k}-{i}" for i, (k, _) in enumerate(SECRETS)])
def test_no_secret_material_survives(kind, text):
    """The whole point: the sensitive substring must be gone, not shortened."""
    result = scrub(text)
    secret = max(text.split(), key=len).strip("\"'")

    assert secret not in result.text


INNOCENT = [
    "The password reset flow was broken for users with a plus sign in their email.",
    "We store the API key in Secret Manager, never in the repo.",
    "The asset hash is d2a84f4b8b650937ec8f73cd8be2c74add5a911ba64df27458ed8229da804a26",
    "Renamed the secret_key setting to signing_key for clarity.",
    "See https://github.com/acme/payments/pull/1234 for the discussion.",
    "The token expires after 3600 seconds and the refresh happens at 3000.",
    "auth_token handling moved into the middleware.",
    "Run `make test` and check that the password field is masked in logs.",
    "Miguel asked whether the api key rotation was automated. It is not.",
]


@pytest.mark.parametrize("text", INNOCENT)
def test_innocent_prose_is_untouched(text):
    """A false positive silently corrupts a memory — as bad as missing a secret."""
    result = scrub(text)

    assert result.clean, f"false positive {result.redactions} on: {text!r}"
    assert result.text == text


class TestPrivateKeys:
    @pytest.mark.parametrize(
        "header",
        [
            "-----BEGIN PRIVATE KEY-----",
            "-----BEGIN RSA PRIVATE KEY-----",
            "-----BEGIN OPENSSH PRIVATE KEY-----",
            "-----BEGIN EC PRIVATE KEY-----",
        ],
    )
    def test_a_private_key_refuses_the_save(self, header):
        """Redacting silently would hide an incident that needs a key rotation."""
        with pytest.raises(PrivateKeyFound):
            scrub(f"Here is the deploy key:\n{header}\nMIIEvQIBADAN...\n-----END PRIVATE KEY-----")

    def test_the_error_says_what_to_do(self):
        with pytest.raises(PrivateKeyFound, match="Rotate the key"):
            scrub("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----")

    def test_talking_about_private_keys_is_fine(self):
        assert scrub("We rotated the private key after the incident.").clean


class TestDenylist:
    def test_org_literals_are_redacted(self):
        result = scrub("Deployed to internal-prod.acme.corp for BigClient", denylist=["BigClient"])

        assert "BigClient" not in result.text
        assert result.redactions == {"denylisted": 1}

    def test_matching_is_case_insensitive(self):
        assert "bigclient" not in scrub("bigclient asked", denylist=["BigClient"]).text.lower()

    def test_an_empty_denylist_changes_nothing(self):
        text = "Deployed for BigClient"
        assert scrub(text, denylist=[]).text == text
        assert scrub(text, denylist=["", "  "]).text == text


class TestReporting:
    def test_counts_every_occurrence(self):
        result = scrub("keys AKIAIOSFODNN7EXAMPLE and AKIAJKLMNOPQRSTUVWXY here")
        assert result.redactions["aws-key"] == 2

    def test_summary_is_human_readable(self):
        result = scrub("AKIAIOSFODNN7EXAMPLE and AKIAJKLMNOPQRSTUVWXY")
        assert result.summary() == "redacted 2x aws-key"

    def test_clean_text_summarises_as_nothing(self):
        assert scrub("a normal memory about caching").summary() == ""

    def test_empty_input_is_safe(self):
        assert scrub("").clean


def test_a_vendor_match_is_not_swallowed_by_the_generic_rule():
    """`API_KEY=sk-ant-…` must report the anthropic key, not a generic credential.

    Which kind of secret leaked is the actionable part: it says what to rotate.
    """
    result = scrub("export ANTHROPIC_API_KEY=sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789")

    assert result.redactions == {"anthropic-key": 1}
    assert "[redacted:anthropic-key]" in result.text
    assert "sk-ant" not in result.text
