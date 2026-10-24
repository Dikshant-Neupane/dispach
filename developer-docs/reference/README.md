# Reference

Use the guides to learn workflows and the references when implementing against a contract.

- **HTTP API:** the docs site renders the API Reference section's HTTP API pages from
  [`openapi.json`](openapi.json), generated from the registered router and Zod request schemas.
- **Live server:** every running server exposes the same document at `/v1/openapi.json` and a Scalar
  browser at `/docs`.
- **Manifest:** the binding field reference is the Agent manifest specification.
- **Plugin API:** the binding extension contract is the Plugin API specification.
- **Wire and events:** the binding protocol is the Wire protocol specification.
- **Workspace:** file tiers and authoring rules are in the Workspace specification.

The generated HTTP reference describes requests, status codes, and the common error shape. Success
response types live in the TypeScript client, where `tsc` checks them against actual usage.

The generated document's `info.version` comes from the source tree's package version, which
`bun run release` updates when it regenerates the document. Between releases it names the last
release rather than the code in front of you; use the exact Git tag or `GET /v1/health` from the
deployed image when matching a contract to a running server.
