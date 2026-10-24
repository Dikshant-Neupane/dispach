# Writing documentation

Public documentation lives in `developer-docs/` and is published by the Next.js and Fumadocs site in `site/`, which reads the Markdown in place and serves it at `/docs`. The site is deployed on Vercel. Internal design history and binding contracts stay in `docs/`.

## Choose the right home

- Add task-oriented setup and integration guidance to `developer-docs/runtime`.
- Add contribution workflow to `developer-docs/contributing`.
- Add silo lifecycle material to `developer-docs/control-plane`.
- Update a binding specification in `docs/` when code changes the contract.
- Link to an internal specification when readers need exact fields; do not copy the entire document into a guide.

Each section (`runtime`, `contributing`, `control-plane`, `reference`) has its own `README.md`, which is the section's index page, and `SUMMARY.md`, which is its sidebar: `- [Releasing](releasing.md)` is a page, a bare `- Title` is a group, and two spaces of indent nest one level. Add every new page to that section's summary. A page's title is its first `#` heading; no frontmatter is needed.

`developer-docs/gitbook-docs.yaml` lists the sections and their directories. Despite its name it no longer configures a hosted service: `bun run docs:check` reads it to find each section, then checks that each has a `README.md` and `SUMMARY.md`, every page appears in its summary, and every local link and anchor resolves. The site reads the same `SUMMARY.md` files (`site/lib/tree.ts`) and fails its build if a summary names a page that did not load. A new section needs an entry in that file and in `site/lib/tree.ts` and `site/lib/source.ts`.

Preview the site locally:

```bash
bun install --cwd site
bun run --cwd site dev
```

## API reference

The server generates OpenAPI from the same router and Zod schemas used at runtime. The site renders the HTTP API pages from the committed snapshot. Refresh it after an API change:

```bash
bun run docs:generate
bun run docs:check
```

Do not edit `developer-docs/reference/openapi.json` by hand.

## Published branch

The docs site documents the branch it is deployed from, with no separate Stable and Next versions.
Pages may describe pre-release behavior, but must label it with the release line that provides it.
Describe planned behavior only when it is clearly marked as planned.
