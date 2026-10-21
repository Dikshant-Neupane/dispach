#!/usr/bin/env bun
/**
 * The deterministic tool server every harness in the head-to-head is given: Streamable HTTP MCP at
 * `/mcp`, eight tools over an in-memory world, and two control routes the runner uses — `POST /reset`
 * loads a task's world, `GET /state` returns what the world looks like now plus every call made.
 * A task is graded on that state, never by a model reading the reply.
 *
 *   bun scripts/bench/tools-server.ts --port 8788
 *
 * Lenient on purpose, because the point is that every harness's client connects: JSON responses
 * rather than SSE (the spec lets a server choose), any protocol version the client asks for is
 * echoed, a session id is issued and never checked, and the optional GET stream answers 405.
 */

export interface Order {
    readonly id: string
    readonly status: string
    readonly total: number
    readonly items: readonly string[]
}

/** What `POST /reset` loads. Every field is optional; absent ones start empty. */
export interface World {
    readonly kv?: Readonly<Record<string, string>>
    readonly files?: Readonly<Record<string, string>>
    readonly orders?: readonly Order[]
    /** ISO instant `now` reports. Fixed, so a date-dependent answer is gradeable. */
    readonly clock?: string
    /** Tool name → how many of its first calls fail with a transient error, for recovery tasks. */
    readonly failures?: Readonly<Record<string, number>>
}

export interface CallRecord {
    readonly seq: number
    readonly tool: string
    readonly args: Record<string, unknown>
    readonly isError: boolean
}

export interface WorldState {
    readonly kv: Record<string, string>
    readonly files: Record<string, string>
    readonly messages: { readonly to: string; readonly text: string }[]
    readonly calls: CallRecord[]
}

const DEFAULT_CLOCK = "2026-03-14T09:30:00Z"

interface ToolDef {
    readonly name: string
    readonly description: string
    readonly properties: Record<string, { type: string; description: string }>
    readonly readOnly: boolean
}

const str = (description: string) => ({ type: "string", description })

const TOOLS: readonly ToolDef[] = [
    {
        name: "kv_get",
        description: "Read a value from the key-value store.",
        properties: { key: str("The key to read.") },
        readOnly: true,
    },
    {
        name: "kv_set",
        description: "Write a value to the key-value store, replacing any existing value.",
        properties: { key: str("The key to write."), value: str("The value to store.") },
        readOnly: false,
    },
    {
        name: "read_file",
        description: "Read a text file from the workspace.",
        properties: { path: str("Path relative to the workspace, e.g. notes/todo.md.") },
        readOnly: true,
    },
    {
        name: "write_file",
        description: "Create or overwrite a text file in the workspace.",
        properties: {
            path: str("Path relative to the workspace."),
            content: str("The whole new content of the file."),
        },
        readOnly: false,
    },
    {
        name: "calculator",
        description: "Evaluate an arithmetic expression: numbers, + - * / %, and parentheses.",
        properties: { expression: str("The expression, e.g. (12.5 * 4) - 3.") },
        readOnly: true,
    },
    {
        name: "lookup_order",
        description: "Look up an order by its id: status, total and items.",
        properties: { order_id: str("The order id, e.g. A-1001.") },
        readOnly: true,
    },
    {
        name: "now",
        description: "The current date and time, in UTC.",
        properties: {},
        readOnly: true,
    },
    {
        name: "send_message",
        description: "Send a message to a person.",
        properties: {
            to: str("The recipient's name or address."),
            text: str("The message text."),
        },
        readOnly: false,
    },
]

const ARITHMETIC = /^[\d\s.+\-*/%()]+$/

function normalisePath(path: string): string {
    return path.replace(/^\.?\/+/, "").replace(/\/{2,}/g, "/")
}

export interface ToolServer {
    readonly fetch: (req: Request) => Promise<Response>
    reset(world: World): void
    state(): WorldState
}

export function createToolServer(initial: World = {}): ToolServer {
    let world: World = initial
    let kv: Record<string, string> = {}
    let files: Record<string, string> = {}
    let messages: { to: string; text: string }[] = []
    let calls: CallRecord[] = []
    let failuresLeft: Record<string, number> = {}

    const reset = (next: World) => {
        world = next
        kv = { ...next.kv }
        files = Object.fromEntries(
            Object.entries(next.files ?? {}).map(([path, text]) => [normalisePath(path), text]),
        )
        messages = []
        calls = []
        failuresLeft = { ...next.failures }
    }
    reset(initial)

    /** The tool's text, and whether it is an error the model should see as one. */
    const run = (tool: string, args: Record<string, unknown>): [string, boolean] => {
        const arg = (name: string) => (typeof args[name] === "string" ? (args[name] as string) : "")
        const left = failuresLeft[tool] ?? 0
        if (left > 0) {
            failuresLeft[tool] = left - 1
            return [`${tool} is temporarily unavailable. Try again.`, true]
        }
        switch (tool) {
            case "kv_get": {
                const value = kv[arg("key")]
                return value === undefined
                    ? [`No value is stored under "${arg("key")}".`, false]
                    : [value, false]
            }
            case "kv_set":
                kv[arg("key")] = arg("value")
                return [`Stored "${arg("key")}".`, false]
            case "read_file": {
                const text = files[normalisePath(arg("path"))]
                return text === undefined ? [`No file at ${arg("path")}.`, true] : [text, false]
            }
            case "write_file":
                files[normalisePath(arg("path"))] = arg("content")
                return [`Wrote ${arg("path")} (${arg("content").length} characters).`, false]
            case "calculator": {
                const expression = arg("expression")
                if (!ARITHMETIC.test(expression))
                    return ["Only numbers, + - * / %, and parentheses are allowed.", true]
                try {
                    // Safe: the regex above admits digits, operators and parentheses only.
                    const value = Function(`"use strict"; return (${expression})`)() as unknown
                    if (typeof value !== "number" || !Number.isFinite(value))
                        return [`${expression} has no finite value.`, true]
                    return [String(Number(value.toPrecision(12))), false]
                } catch {
                    return [`Could not parse ${expression}.`, true]
                }
            }
            case "lookup_order": {
                const order = world.orders?.find((o) => o.id === arg("order_id"))
                return order === undefined
                    ? [`No order with id ${arg("order_id")}.`, true]
                    : [JSON.stringify(order), false]
            }
            case "now":
                return [world.clock ?? DEFAULT_CLOCK, false]
            case "send_message":
                messages.push({ to: arg("to"), text: arg("text") })
                return [`Sent to ${arg("to")}.`, false]
            default:
                return [`Unknown tool ${tool}.`, true]
        }
    }

    const rpc = (message: Record<string, unknown>): Record<string, unknown> | undefined => {
        const id = message.id
        // A notification has no id and gets no response.
        if (id === undefined || id === null) return undefined
        const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result })
        const fail = (code: number, text: string) => ({
            jsonrpc: "2.0",
            id,
            error: { code, message: text },
        })
        const params = (message.params ?? {}) as Record<string, unknown>
        switch (message.method) {
            case "initialize":
                return ok({
                    protocolVersion: params.protocolVersion ?? "2025-06-18",
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: { name: "bench-tools", version: "1.0.0" },
                })
            case "ping":
                return ok({})
            case "tools/list":
                return ok({
                    tools: TOOLS.map((t) => ({
                        name: t.name,
                        description: t.description,
                        inputSchema: {
                            type: "object",
                            properties: t.properties,
                            required: Object.keys(t.properties),
                        },
                        annotations: { readOnlyHint: t.readOnly, destructiveHint: false },
                    })),
                })
            case "tools/call": {
                const name = String(params.name ?? "")
                if (!TOOLS.some((t) => t.name === name))
                    return fail(-32602, `Unknown tool: ${name}`)
                const args = (params.arguments ?? {}) as Record<string, unknown>
                const [text, isError] = run(name, args)
                calls.push({ seq: calls.length + 1, tool: name, args, isError })
                return ok({ content: [{ type: "text", text }], isError })
            }
            default:
                return fail(-32601, `Method not found: ${String(message.method)}`)
        }
    }

    const fetchHandler = async (req: Request): Promise<Response> => {
        const path = new URL(req.url).pathname
        if (path === "/reset" && req.method === "POST") {
            reset((await req.json()) as World)
            return Response.json({ ok: true })
        }
        if (path === "/state" && req.method === "GET") return Response.json(stateOf())
        if (path !== "/mcp")
            return Response.json(
                { error: "The bench tool server serves /mcp, /reset and /state." },
                { status: 404 },
            )
        // No server-initiated stream and nothing to tear down on a session end.
        if (req.method === "GET")
            return new Response(null, { status: 405, headers: { allow: "POST" } })
        if (req.method === "DELETE") return new Response(null, { status: 200 })
        if (req.method !== "POST")
            return new Response(null, { status: 405, headers: { allow: "POST" } })

        let body: unknown
        try {
            body = await req.json()
        } catch {
            return Response.json(
                { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
                { status: 400 },
            )
        }
        const batch = Array.isArray(body)
        const answers = ((batch ? body : [body]) as Record<string, unknown>[])
            .map((m) => rpc(m))
            .filter((a) => a !== undefined)
        const headers: Record<string, string> =
            (body as { method?: string }).method === "initialize"
                ? { "mcp-session-id": crypto.randomUUID() }
                : {}
        if (answers.length === 0) return new Response(null, { status: 202, headers })
        return Response.json(batch ? answers : answers[0], { headers })
    }

    const stateOf = (): WorldState => ({
        kv: { ...kv },
        files: { ...files },
        messages: [...messages],
        calls: [...calls],
    })

    return { fetch: fetchHandler, reset, state: stateOf }
}

if (import.meta.main) {
    const args = process.argv.slice(2)
    const at = args.indexOf("--port")
    const port = at === -1 ? 8788 : Number(args[at + 1])
    const server = createToolServer()
    Bun.serve({ port, hostname: "127.0.0.1", idleTimeout: 0, fetch: server.fetch })
    console.log(`bench tools · http://127.0.0.1:${port}/mcp · POST /reset · GET /state`)
}
