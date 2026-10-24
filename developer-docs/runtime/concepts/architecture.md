# Architecture

Dispach keeps the agent harness independent from its transports and optional integrations.

```text
channel | HTTP API | schedule
              |
              v
       core agent harness
 context -> model -> tools -> observation
              |
              v
       store and outbox
```

## Package boundaries

| Package area | Owns |
| --- | --- |
| `packages/core` | Loop, context, tools, memory, store, schedules, and public plugin contracts |
| `packages/server` | HTTP, SSE, WebSocket, auth, and OpenAPI |
| `packages/client` | Typed API client and stream handling |
| `packages/cli` | Commands and terminal interface |
| `packages/web` | Browser UI served on the same origin as the API |
| `packages/channel-*` | First-party channel transports: Telegram, WhatsApp, Slack, Teams, and A2A |
| `packages/tools-*` | Optional tool providers: system (shell and files), web, Composio, and MCP |
| `packages/model-*` | Model transports beyond chat completions, such as Bedrock Converse |
| `packages/media-*` | Media providers beyond the built-in OpenAI one, such as AWS |
| `packages/control` | Separate container lifecycle control plane, licensed FSL-1.1-ALv2 rather than Apache-2.0, and not part of the npm package or image |

Core imports no sibling packages. This keeps the embedder-facing harness usable without the CLI, server, or provider implementations.

## Startup boundary

Local configuration, stores, manifests, and tool registries load before `runtime.ready`. Anything that needs network I/O starts afterwards and reports state through events. This boundary makes readiness a statement about the runtime itself rather than the speed of every external service.

For binding details and rationales, read the Architecture and Decision Log documents in the
repository.
