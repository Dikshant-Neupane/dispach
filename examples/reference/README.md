# reference

Every field `agent.yaml` accepts, in one runnable file. `../minimal/` is the smallest thing that
works; this is the opposite end — the worked copy of `docs/02-SPEC-MANIFEST.md`.

```bash
cp .env.example .env    # then fill in one preset
dispach validate ./agent.yaml
dispach run ./agent.yaml
```

## How to read it

Every section is **live**: `model` (all three roles, fallbacks, capabilities), `context` (the
workspace tiers, thresholds), `tools` (both dialects, providers, policy), `limits`, `phases`,
`skills`, `knowledge`, `memory`, `channels`, `delivery`, `server`, `schedules` and `plugins`. What
stays commented is optional rather than unbuilt — `extends`, `subagents`, and the alternatives
inside a block, such as a second plugin entry — so uncommenting one is a choice about this agent,
not a wait for a phase. The section headings still carry the phase that delivered each block.

A section a build does not implement is **refused at load** rather than parsed and ignored —
because a runtime that parses configuration and ignores it lies about what it is doing — but no
section is in that state today; `tools.search: {enabled: true}` is the one setting refused that way,
and by design.

## Why this one has tools and `minimal` does not

`minimal` pins nothing on purpose, so `/tools` there reports an empty catalogue and the model
correctly tells you it has none. That is the honest output for that manifest, not a bug — a
frequent first surprise.

This one pins `now` and `memory_write`. Both are built in, so the only credential needed is a model
key: no provider, no network beyond the model call, nothing to warm.

They also demonstrate the two execution modes. `now` is read-only and runs in parallel with other
reads; `memory_write` is mutating, so it serialises, holds one of the six reserved write slots, and
is never retried. Ask for both in one message and the transcript shows the chain:

```
› What time is it right now? Save a note that you checked.
  · now — ok · 18 ms
  · memory_write — ok · 1 ms
It is Thursday, 13 August 2026 at 16:56 UTC. I saved a note that I checked the time.
  751 prompt · 254 output · 6814 ms
```

`memory_write` appends to `./memory/notes.md` beside this file — a real file, deliberately, because
a mutating tool that cannot succeed teaches the model to retry until the step budget runs out.

## Adding Composio

Uncomment the `composio:` block inside `tools.providers`, add its slugs to `pinned`, then:

```bash
dispach tools ./agent.yaml --warm    # fetch the schemas into .dispach/tools.cache.json
dispach tools ./agent.yaml           # see the catalogue the model will get
```

The warm step is required rather than convenient. Resolution happens during boot, where no network
call is allowed, so a cold cache fails the load naming the slugs and that command. Once warmed, the
agent boots and serves its catalogue with no Composio key present at all.
