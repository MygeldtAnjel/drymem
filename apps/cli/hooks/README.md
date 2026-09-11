# Legacy hooks (Python + bash)

Superseded by the TypeScript client: `npx drymem hook <event>`, in
[`../src/hooks.ts`](../src/hooks.ts). Same behaviour, one runtime, no Python on
the laptop.

**They are still here on purpose.** Miguel's `.claude/settings.json` points at
these scripts, and `npx drymem` cannot replace them until the package is
published to npm. Deleting them now would break a working setup in exchange for
one that does not exist yet.

Remove them once `drymem` is on npm and `npx drymem setup` has been run.
