# What's new in 0.2.0

0.2.0 is the first release since 0.1.3, and the first measured against other harnesses. It brings
the seventeen 0.2.0 pre-releases together for anyone running agents behind their own product: more
models, MCP and subagents, a much larger HTTP API, and tighter handling of secrets. A 0.1.3 agent and
its store boot on it unchanged.

## Measured against Hermes and OpenClaw

The same 25 multi-turn tasks, the same tools and the same pinned providers, five runs each, graded
on the tools' final state rather than the reply's wording:

- **Ahead of OpenClaw 2026.10.5 on all 11 models**, and level with or ahead of Hermes 0.19.0 on 8
  of 11.
- **125/125 on five models**: Claude Opus 5.5, Claude Sonnet 5.5, GPT-6.1 Sol, GLM 5.3 and DeepSeek
  V4 Pro.
- **Cheapest of the three on 10 of 11 models.** Hermes cost $0.01 less on GPT-6.1 Sol.
- **Behind Hermes on three**: Gemini 4 Argon, qwen3.5-9b and gpt-oss-20b. These are listed with
  the rest.

The full tables, the dialect comparison and how the runs were made are on [Benchmarks](benchmarks.md).
Every run is committed under
[`evals/harness/`](https://github.com/moeen-mahmud/dispach/tree/main/evals/harness).

## Highlights

**Agents that finish the job.** `init` now writes native tool calls wherever the model supports them;
on the benchmark native tied or beat the plain-text dialect on all 13 models measured both ways. A step that would end
silent, on "I'll do that", or claiming a save that never happened gets one note from the runtime and
one more step. A retry the tool itself asked for is no longer refused as a loop, and a tool result can
take a quarter of the context window instead of a flat 2,000 tokens.

**Any model, through more than one door.** Model transports are pluggable: AWS Bedrock ships
(`api: bedrock-converse`), and a plugin can register another. `fallbacks` tries the next model when
an endpoint fails before any output. Images reach models with vision, signed thinking is replayed
across tool calls, and a refused reply ends the turn as `model_refused` instead of an empty answer.

**Prompt caching that survives a memory write.** Only byte-stable context is sent as system messages,
so a saved note no longer empties OpenAI's cache, and Claude through OpenRouter gets cache markers.

**MCP and subagents.** `tools.providers.mcp` serves tools from remote MCP servers over Streamable HTTP,
pinned by name like any other tool. `subagents:` routes a call to a throwaway child of the same agent,
optionally on a cheaper model, and the parent reads its artifact instead of the raw output.

**An HTTP API for running other people's agents.** Agent templates, per-agent secrets, metered model
calls (`/v1/usage`) with ids a biller can debit, signed outbound webhooks, concurrency and token
limits, exact-text deliveries, repair of an agent that will not load, and `GET /v1/backup` for the
whole silo. `dispach/client` ships its own type declarations and no terminal UI.

**Secrets stay secret.** `file_read` and `grep` never read `.env`, key files or credential
directories, path rules match the normalised path, `exec` can run with the runtime's secrets
scrubbed, and `X_FILE` sets a variable from a file without it entering the environment.

**Memory without a restart.** A saved note, or an edit to `MEMORY.md`, reaches every session on the
next turn. `memory_forget` deletes exactly the notes named, and a conversation can be taken out of
recall without deleting it.

**Runs where you deploy.** A Kubernetes guide and example, a drain on stop for running turns, `ffmpeg`
in the image for voice notes, and one host token shared by every agent in a sandbox.

## Upgrading from 0.1.3

1. Back up `store.db`. Migrations 20 to 31 run on first boot and have no down-migration.
2. Install 0.2.0 (`npm install --global dispach@latest`, `brew upgrade dispach`, or
   `docker pull ghcr.io/moeen-mahmud/dispach:0.2.0`) and start it. No `agent.yaml` change is needed.
3. Check the four breaking changes, if they touch you:
   - a plugin must declare `dispachApi: "^0.2"`;
   - a reload during a turn answers `202 pending` instead of `409`;
   - `GET /v1/agents/:id` on a stopped agent returns a `status: "disabled"` row instead of 404;
   - a scheduled run that ends in `timeout`, `max_steps`, `no_progress` or `error` is recorded as an
     error.
4. Expect one prompt-cache miss on the first turn, because workspace files now reach the model under
   their names.

An existing manifest keeps its tool-call dialect. To move an agent to native tool calls, set
`tools.dialect: native`.

## Experimental

These are on the HTTP API only and may change within 0.2.x: rooms, participants and DMs; stand-ins
and delegation between members' agents; team memory scopes; per-message model roles; the Slack,
Microsoft Teams and A2A channels; media (transcription, image generation, spoken replies); and
Firecrawl as a web backend. See [Stable and pre-releases](releases.md) for what experimental means
here.

## Read more

- [`CHANGELOG.md`](https://github.com/moeen-mahmud/dispach/blob/main/CHANGELOG.md): every change, one
  line each.
- [`docs/00-DECISIONS.md`](https://github.com/moeen-mahmud/dispach/blob/main/docs/00-DECISIONS.md):
  why each of them was made, with its measurement.
- [`evals/CLAIMS.md`](https://github.com/moeen-mahmud/dispach/blob/main/evals/CLAIMS.md): every public
  number and the file it comes from.
