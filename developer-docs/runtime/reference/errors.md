# Errors

API failures use a stable machine-readable code and a human-readable message. Runtime errors also carry a `hint` that explains the likely corrective action.

```json
{
  "error": {
    "code": "agent_not_found",
    "message": "No agent \"milo\".",
    "hint": "Check the id — it is case-sensitive, and a session key includes its channel segment."
  }
}
```

Treat `code` as the application branch and `message` or `hint` as diagnostic text. Do not parse prose.

| HTTP status | Typical action |
| --- | --- |
| `400` | Fix the request shape, an invalid field, or a configuration that fails validation |
| `401` | Supply a valid operator key |
| `403` | Use a key with the required scope or change policy |
| `404` | Refresh the addressed agent, turn, session, or resource |
| `409` | Resolve state conflict; do not blindly overwrite or duplicate work |
| `429` | Back off or address configured capacity and token limits |
| `500` | Record the code, message, hint, and relevant IDs before retrying |
| `501` | The server was composed without the capability the route needs, such as a provisioner, a credential writer, or templates; use a server that provides it |
| `503` | `GET /v1/ready` while the server is still starting (retry until `200`) or draining for a stop |

Idempotent writes are safe to retry with the same key and same body. Reusing a key for different content is an error. A disconnected turn stream is not a failed turn; reattach before deciding whether to retry the original message.

The typed client throws structured errors with status and code. Preserve those fields when mapping them into your application's error model.
