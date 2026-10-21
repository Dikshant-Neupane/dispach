# Hermes Agent for the harness benchmark. The official installer selects the `all` extra; without
# it there is no MCP client (`mcp.client.streamable_http is not available`).
FROM python:3.12-bookworm
RUN pip install --no-cache-dir "hermes-agent[all]==0.19.0"
CMD ["sleep", "infinity"]
