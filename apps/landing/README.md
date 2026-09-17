# drymem — the public site

The marketing page and the documentation, built as static files. Its own build
rather than a route inside the console: the console is behind a sign-in and
serves one organisation, while this is public, has to be indexable, and should
sit on a CDN under its own domain.

Two things are shared with the product, both imported from source so neither can
drift: the design tokens (the same palette as `apps/web/src/index.css`) and the
documents in `docs/`, which the docs pages render directly.

```bash
pnpm --filter @drymem/landing run dev      # localhost:5173
pnpm --filter @drymem/landing run build    # → apps/landing/dist
```

`dist/` is plain static output — drop it on Cloudflare Pages, Vercel, Netlify,
S3, or any nginx. There is no server side.

## The one thing to configure

The request-access form posts to a drymem server. Point it at one at build time:

```bash
VITE_DRYMEM_API=https://drymem.your-company.com pnpm --filter @drymem/landing run build
```

Left unset it posts to its own origin, which is right only if the site is served
by the API itself.

That server must also be told which origin to accept, or the browser will refuse
the request before it leaves:

```bash
LANDING_ORIGIN=https://drymem.dev    # in the server's .env
```

That is the only cross-origin call in the whole product. Everything else is one
origin on purpose.

## Where a request goes

Into `access_requests` in Postgres, and as an email to whoever owns the server
(override with `ACCESS_REQUESTS_TO`). With no mail configured it is written to
the server log instead — a queue nobody is told about is a queue nobody empties.

Approving one is deliberate and stays in a shell, because it hands somebody the
keys to a tenant:

```bash
drymem-admin org-create "Their Company" --owner them@example.com
```

They then set their own password from the sign-in page's *Forgot password*.
Recording the decision (`PATCH /access-requests/:id`) is bookkeeping and
provisions nothing.
