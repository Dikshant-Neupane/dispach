# Configuration

`agent.yaml` is the declarative source for an agent. The loader rejects unknown or invalid values and reports a corrective hint.

| Area | Controls |
| --- | --- |
| `model` | Roles, model IDs, endpoints, key environment names, and capabilities, including `promptStyle` and its `examplesIn` placement |
| `context` | Workspace tiers, budgets, soul selection, compaction thresholds, output reserve, and observation size |
| `tools` | Dialect, pinned providers and tools, policy, untrusted-write behavior, and provider settings |
| `phases` | Per-phase instructions, transitions, and visible tools |
| `skills` | Skill directories, selection, and which skills' scripts become tools |
| `knowledge` | Keyword-gated reference entries and their per-turn budget |
| `limits` | `maxSteps`, `noProgress`, turn and tool timeouts, `maxParallelTools`, `maxConcurrentTurns`, `reloadHoldMs`, `maxHops`, and `tokens` |
| `memory` | Store and retrieval behavior |
| `schedules` | Cron, interval, and one-shot inbound triggers |
| `channels` | Transport configuration and inbound allowlists |
| `delivery` | Default and named outbound routing targets |
| `team` | Members a supervisor agent delegates to |
| `subagents` | Throwaway children of the same agent that tool calls are routed to |
| `media` | Transcription, image generation, and spoken replies (experimental in 0.2.0) |
| `standIn` | Answering for a member while they are away (experimental in 0.2.0) |
| `delegation` | Delegation between members' agents (experimental in 0.2.0) |
| `plugins` | Packages loaded at boot and their configuration |
| `server` | HTTP binding and server behavior for the agent runtime |

Use the CLI field catalogue when possible:

```bash
dispach config list milo
dispach config set milo model.main.id gpt-4.1-mini
dispach validate milo
```

Secrets are values in the environment; configuration stores only their variable names. Plugins resolve at boot, and the runtime never installs packages on demand.

The authoritative field-by-field contracts are the Agent manifest specification and Workspace
specification. The current full example is `examples/reference/agent.yaml`.
