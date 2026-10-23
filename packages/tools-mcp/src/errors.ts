/**
 * Every way the MCP provider fails, each with the hint that names the fix.
 *
 * `ConfigError` for what a manifest edit fixes, `ToolError` for what happened during a call. A call
 * failure reaches the model as a failed observation, so its hint is written for whoever reads the
 * transcript afterwards as much as for the model.
 */

import { BRAND, ConfigError, ToolError } from "@dispach/core"

const FIELD = "tools.providers.mcp"

export function mcpConfigInvalid(message: string, hint: string, field = FIELD): ConfigError {
    return new ConfigError({ code: "mcp_config_invalid", message, hint, field })
}

export function mcpCacheMiss(
    servers: readonly string[],
    slugs: readonly string[],
    path: string,
): ConfigError {
    return new ConfigError({
        code: "mcp_cache_miss",
        message: `${slugs.length === 1 ? "A pinned MCP tool is" : `${slugs.length} pinned MCP tools are`} not in the cache: ${slugs.join(", ")}. Nothing is cached yet for ${servers.join(", ")}.`,
        hint: `Boot resolves MCP tools from ${path} and contacts no server, because nothing may touch the network before runtime.ready, and a server that is down must not stop an agent booting. Run \`${BRAND.slug} tools <manifest> --warm\` once with the server running to fill it, then start again.`,
        field: "tools.pinned",
    })
}

export function mcpHeaderEnvMissing(server: string, header: string, envVar: string): ToolError {
    return new ToolError({
        code: "mcp_header_env_missing",
        message: `The MCP server "${server}" needs the ${header} header from ${envVar}, which is not set.`,
        hint: `Set ${envVar} in the environment or in the .env beside the manifest. The manifest names the variable (${FIELD}.servers.${server}.headersEnv), never the value.`,
    })
}

export function mcpRequestFailed(server: string, url: string, detail: string): ToolError {
    return new ToolError({
        code: "mcp_request_failed",
        message: `The MCP server "${server}" at ${url} did not answer: ${detail}`,
        hint: "Check the server is running and reachable from this host (a loopback URL means the same machine or pod). If it needs a token, headersEnv names the variable that holds it. An agent keeps serving the tools it cached; only calls fail while the server is down.",
    })
}

export function mcpToolFailed(server: string, tool: string, detail: string): ToolError {
    return new ToolError({
        code: "mcp_tool_failed",
        message: `The MCP tool "${tool}" on "${server}" reported an error: ${detail}`,
        // The server's words decide whether a retry helps. This hint said none would, and the harness
        // benchmark measured it overriding a server that said "temporarily unavailable. Try again":
        // recover-retry and recover-persist failed in every arm (`evals/harness/runs/after-ac5dcc5`).
        // "Up to twice" matches the repeat guard's allowance after a temporary failure (14.127, 14.129):
        // "once" stopped Sonnet 5.5 one attempt short of a write that succeeded on the third.
        hint: "The server's own words above say what went wrong. If they say the failure is temporary, retry up to twice. Otherwise a tool outside the server's allowlist, a missing upstream credential or an invalid argument are the usual causes, and retrying the same call will not fix those.",
    })
}
