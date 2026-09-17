"""
A team using drymem, end to end, against a real deployment.

Not a unit test and not a replacement for one. The suites answer "is this
safe"; this answers "does this work for a team", which is a different question
and the one the pilot actually rides on. It creates people, puts them on
projects, has them write and share memories, and then checks what each of them
can see — over HTTP, the same way a browser would.

It runs against the throwaway stack in `docker-compose.rehearsal.yml`, on its
own ports and volumes, so it can never touch a working instance.

    make rehearsal

Every step prints what it did and what it checked. A failed check stops the run
and says which person saw what they should not have.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Built once by `make build`; the rehearsal drives the same bundle a user runs.
CLI = Path(__file__).resolve().parents[3] / "apps" / "cli" / "dist" / "cli.js"

BASE = "http://127.0.0.1:8081"
PROJECT = "github.com/acme/payments"
OTHER_PROJECT = "github.com/acme/billing"

PASSWORD = "correct horse battery staple"

checks = {"passed": 0, "failed": 0}


class Person:
    """One teammate, with their own cookie jar — the browser's view of them."""

    def __init__(self, name: str, email: str):
        self.name = name
        self.email = email
        self.cookies: dict[str, str] = {}

    def call(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
        request = urllib.request.Request(
            f"{BASE}{path}",
            method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={
                "Content-Type": "application/json",
                # The same-origin marker a browser sends. Without it the API
                # refuses any cookie-authenticated write, which is the point:
                # a cross-site form post cannot set a custom header.
                "X-Drymem-Client": "rehearsal",
            },
        )
        if self.cookies:
            request.add_header(
                "Cookie", "; ".join(f"{k}={v}" for k, v in self.cookies.items())
            )
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                self._remember(response)
                raw = response.read()
                return response.status, json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            self._remember(error)
            raw = error.read()
            try:
                return error.code, json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                return error.code, {"detail": raw.decode()[:200]}

    def _remember(self, response) -> None:
        for header in response.headers.get_all("Set-Cookie") or []:
            pair = header.split(";", 1)[0]
            if "=" in pair:
                key, value = pair.split("=", 1)
                self.cookies[key] = value

    def get(self, path: str):
        return self.call("GET", path)

    def post(self, path: str, body: dict | None = None):
        return self.call("POST", path, body or {})


def must(status: int, body: dict, what: str, expected: int = 200) -> dict:
    """A call that has to work for the rest of the rehearsal to mean anything.

    Checked rather than assumed: the first version of this script posted to a
    route that does not exist, ignored the 404, and then reported two baffling
    failures three steps later.
    """
    if status != expected:
        print(f"\n{what} failed: {status} {body}", file=sys.stderr)
        raise SystemExit(1)
    return body


def run_git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True)


def cli(cwd: Path, env: dict, *args: str) -> tuple[int, str]:
    """The real bundled CLI, against the rehearsal server."""
    done = subprocess.run(
        ["node", str(CLI), *args],
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
        # The exit code is the thing being checked, so a failure is data here.
        check=False,
    )
    return done.returncode, done.stdout + done.stderr


def check(what: str, condition: bool, detail: str = "") -> None:
    if condition:
        checks["passed"] += 1
        print(f"    ✓ {what}")
    else:
        checks["failed"] += 1
        print(f"    ✗ {what}")
        if detail:
            print(f"      {detail}")


def step(title: str) -> None:
    print(f"\n{title}")


def wait_for_server() -> None:
    for _ in range(120):
        try:
            with urllib.request.urlopen(f"{BASE}/healthz", timeout=5) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        time.sleep(2)
    print(f"The rehearsal stack never came up on {BASE}.", file=sys.stderr)
    raise SystemExit(2)


def invite(owner: Person, person: Person, role: str = "member") -> None:
    """Invite somebody and accept it, the way the product does it without email."""
    status, body = owner.post("/auth/invites", {"email": person.email, "role": role})
    if status != 200:
        print(f"Could not invite {person.email}: {status} {body}", file=sys.stderr)
        raise SystemExit(1)
    token = body["invite_url"].rstrip("/").split("/")[-1]
    status, _ = person.post(f"/auth/invites/{token}/accept", {"password": PASSWORD})
    if status != 200:
        print(f"{person.email} could not accept: {status}", file=sys.stderr)
        raise SystemExit(1)


def save(person: Person, project: str, summary: str, topic: str, kind: str = "decision"):
    status, body = person.post(
        "/v1/memories",
        {"project_key": project, "summary": summary, "topic_key": topic, "type": kind},
    )
    if status != 200:
        print(f"{person.name} could not save a memory: {status} {body}", file=sys.stderr)
        raise SystemExit(1)
    return body


def titles_visible_to(person: Person, project: str) -> str:
    key = urllib.parse.quote(project)
    _, body = person.get(f"/v1/memories/page?project_key={key}&limit=100")
    return " ".join(e.get("content", "") for e in body.get("episodes", []))


def main() -> int:
    wait_for_server()

    miguel = Person("Miguel", "miguel@acme.test")
    ana = Person("Ana", "ana@acme.test")
    luis = Person("Luis", "luis@acme.test")

    step("1. Miguel sets up the organisation")
    status, body = miguel.post(
        "/auth/signup",
        {
            "org_name": "Acme",
            "email": miguel.email,
            "password": PASSWORD,
            "name": "Miguel Rojas",
        },
    )
    check("the first signup creates the organisation", status == 200, f"got {status} {body}")
    status, _ = Person("Stranger", "x@y.test").post(
        "/auth/signup",
        {"org_name": "Beta", "email": "x@y.test", "password": PASSWORD, "name": "X"},
    )
    check("a second organisation cannot sign itself up", status == 409, f"got {status}")

    step("2. Two coworkers join")
    invite(miguel, ana)
    invite(miguel, luis)
    _, me = ana.get("/v1/me")
    check("Ana is signed in after accepting", me.get("email") == ana.email)

    step("3. Two projects, with different people on them")
    # A project comes into being when somebody saves a memory in it — there is
    # no "create project" call, which is deliberate: the git remote is the id,
    # so an agent writing from a checkout is all it takes.
    save(miguel, PROJECT, "## Summary\nPayments work starts here.", "pay/start", "note")
    save(miguel, OTHER_PROJECT, "## Summary\nBilling work starts here.", "billing/start", "note")

    key = urllib.parse.quote(PROJECT, safe="")
    other = urllib.parse.quote(OTHER_PROJECT, safe="")
    must(*miguel.post(f"/v1/projects/{key}/members", {"email": ana.email}), "adding Ana")
    must(*miguel.post(f"/v1/projects/{other}/members", {"email": luis.email}), "adding Luis")

    _, mine = ana.get("/v1/projects")
    names = [p["project_key"] for p in mine.get("projects", [])]
    check("Ana sees the project she is on", PROJECT in names, str(names))
    check("Ana does not see the one she is not", OTHER_PROJECT not in names, str(names))

    step("4. Miguel writes a decision and keeps it to himself")
    private = save(
        miguel,
        PROJECT,
        "## Summary\nThe staging database password is rotating on Fridays.",
        "ops/staging",
        "note",
    )
    check("Ana cannot read Miguel's private memory", "rotating" not in titles_visible_to(ana, PROJECT))

    step("5. Miguel shares a decision with the team")
    shared = save(
        miguel,
        PROJECT,
        "## Summary\nWe chose Adyen for card payments, at a 1.2% rate.\n\n"
        "## Why\nStripe could not do the local scheme we need.",
        "pay/provider",
    )
    status, _ = miguel.post(f"/v1/memories/{shared['episode_uuid']}/promote")
    check("promoting succeeds", status == 200, f"got {status}")
    seen = titles_visible_to(ana, PROJECT)
    check(
        "Ana can now read it",
        "Adyen" in seen,
        f"Ana sees {len(seen)} characters of memory: {seen[:160]!r}",
    )
    check("Luis, on the other project, cannot", "Adyen" not in titles_visible_to(luis, OTHER_PROJECT))

    step("6. Ana adds what she learned, and Miguel sees it")
    ana_memory = save(
        ana,
        PROJECT,
        "## Summary\nAdyen's sandbox rejects test cards over 100 EUR.\n\n"
        "## Learned\nUse 99.99 in fixtures.",
        "pay/sandbox",
        "discovery",
    )
    status, body = ana.post(f"/v1/memories/{ana_memory['episode_uuid']}/promote")
    check("a member can share her own memory", status == 200, f"got {status} {body}")
    check(
        "Miguel reads Ana's shared memory",
        "sandbox" in titles_visible_to(miguel, PROJECT),
        titles_visible_to(miguel, PROJECT)[:200],
    )

    step("7. The private one stayed private the whole time")
    check(
        "Ana still cannot read it after everything else was shared",
        "rotating" not in titles_visible_to(ana, PROJECT),
    )
    check("and Miguel still can", "rotating" in titles_visible_to(miguel, PROJECT))
    _ = private

    step("8. A question, answered only from what the team wrote")
    status, answer = ana.post(
        "/v1/chats/ask", {"project_key": PROJECT, "question": "What did we choose for payments?"}
    )
    if status == 200:
        text = answer["message"]["content"]
        sources = answer["message"]["sources"]
        check("Ana gets an answer", bool(text.strip()), text[:120])
        check("it cites at least one memory", bool(sources), text[:120])
        check(
            "and never cites the private memory she cannot read",
            all("rotating" not in s.get("title", "") for s in sources),
        )
        print(f"      “{text.strip()[:160]}”")
    else:
        check("asking works", False, f"got {status} — is Ollama serving?")

    step("9. A skill, published once and installed per project")
    status, _ = miguel.post(
        "/v1/skills",
        {
            "name": "payments-testing",
            "content": "---\nname: payments-testing\ndescription: Testing against Adyen's sandbox.\n---\n\nUse 99.99 in fixtures.",
            "project_key": PROJECT,
        },
    )
    check("publishing succeeds", status == 200, f"got {status}")
    _, here = ana.get(f"/v1/skills?project_key={urllib.parse.quote(PROJECT)}")
    check(
        "Ana has it on her project",
        any(s["name"] == "payments-testing" for s in here.get("skills", [])),
    )
    _, there = luis.get(f"/v1/skills?project_key={urllib.parse.quote(OTHER_PROJECT)}")
    check(
        "the other project does not, until somebody turns it on",
        not any(s["name"] == "payments-testing" for s in there.get("skills", [])),
    )

    step("10. The CLI, on a machine that has just cloned the repo")
    # Everything above went over HTTP, which is the browser's path. This is the
    # agent's: a token, a checkout, and the skills landing on disk where Claude
    # Code will read them.
    token = must(*ana.post("/auth/tokens", {"label": "rehearsal"}), "minting a token")["token"]
    checkout = Path(tempfile.mkdtemp(prefix="drymem-rehearsal-"))
    run_git(checkout, "init", "-q")
    run_git(checkout, "remote", "add", "origin", f"https://{PROJECT}.git")

    env = {
        **os.environ,
        "DRYMEM_SERVER_URL": BASE,
        "DRYMEM_TOKEN": token,
        # A platform has to be detected before skills have anywhere to land.
        "HOME": str(checkout),
    }
    (checkout / ".claude").mkdir(exist_ok=True)

    code, out = cli(checkout, env, "whoami")
    check("the CLI resolves the project from the git remote", PROJECT in out, out.strip()[:160])

    code, out = cli(checkout, env, "skills", "pull")
    check("`skills pull` succeeds", code == 0, out.strip()[:200])
    landed = list(checkout.glob(".claude/skills/*/SKILL.md"))
    check(
        "the skill is on disk where the agent reads it",
        any("payments-testing" in str(p) for p in landed),
        f"found {[str(p.relative_to(checkout)) for p in landed]}",
    )
    lock = checkout / ".drymem" / "skills.lock"
    check("and the cache records what the server said", lock.exists())
    if lock.exists():
        check("by name and digest", "payments-testing" in lock.read_text())

    code, out = cli(checkout, env, "context", "5")
    check("the CLI reads the team's memories", "Adyen" in out, out.strip()[:160])

    shutil.rmtree(checkout, ignore_errors=True)

    step("11. The trail says who did what")
    _, trail = miguel.get("/v1/audit?limit=200")
    actions = {e["action"] for e in trail.get("events", [])}
    check("the audit recorded the invitations", "member.invite" in actions, str(sorted(actions)))
    check("and the skill publish", "skill.publish" in actions, str(sorted(actions)))
    _, as_ana = ana.get("/v1/audit")
    check("a member cannot read the audit trail", as_ana.get("events") is None)

    print(f"\n{checks['passed']} checks passed, {checks['failed']} failed")
    return 1 if checks["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
