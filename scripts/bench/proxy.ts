#!/usr/bin/env bun
/**
 * The recording proxy every harness in the head-to-head talks to. It is the only instrument that
 * sees exactly what each harness sends, so prompt overhead is read off the wire, never off a README.
 *
 *   bun --env-file=.env scripts/bench/proxy.ts --label openclaw --model gpt-6.1-sol --log run.jsonl
 *   bun scripts/bench/proxy.ts --label openclaw --mock --latency 200 --log run.jsonl
 *
 * Harnesses are configured with a dummy key and the roster model's real id: a harness reads the id to
 * size its window and pick its prompt style, so a placeholder would handicap it (Dispach refuses to
 * start on an unknown id's 8k default). The proxy swaps in the real key and enforces the roster's id
 * and pinned provider whatever is sent, so harness configs never hold a credential. `--mock` answers "OK" after a fixed latency instead, which
 * is how harness overhead is measured without model noise.
 */
import { appendFileSync } from "node:fs"
import { loadRoster, pinnedFetch, type RosterModel } from "../lib/roster.ts"

export interface ProxyOptions {
    readonly label: string
    /** Upstream model; absent means mock mode. */
    readonly model?: RosterModel
    readonly apiKey?: string
    /** Mock mode: milliseconds before the reply starts. */
    readonly latencyMs?: number
    /** Mock mode: the reply text. */
    readonly reply?: string
    readonly record: (entry: ProxyRecord) => void
    readonly fetch?: typeof fetch
    readonly now?: () => number
}

export interface ProxyRecord {
    readonly ts: string
    readonly label: string
    readonly mode: "upstream" | "mock"
    readonly seq: number
    readonly stream: boolean
    readonly modelRequested: unknown
    readonly modelSent: string
    readonly provider?: string
    /** Bytes of the request as a harness sent it, and of the parts that are pure overhead. */
    readonly bytes: { readonly request: number; readonly system: number; readonly tools: number }
    readonly counts: { readonly messages: number; readonly tools: number }
    readonly status: number
    readonly firstByteMs?: number
    readonly durationMs: number
    readonly usage?: {
        readonly prompt?: number
        readonly completion?: number
        readonly cached?: number
        readonly reasoning?: number
        readonly cost?: number
    }
    readonly servedBy?: string
    readonly generationId?: string
    /** The request as received, so anyone can recount the overhead from the raw log. */
    readonly body: unknown
}

const USAGE_TAIL = 16_384

function systemText(messages: unknown): string {
    if (!Array.isArray(messages)) return ""
    return messages
        .filter(
            (m) =>
                typeof m === "object" &&
                m !== null &&
                ["system", "developer"].includes((m as { role?: string }).role ?? ""),
        )
        .map((m) => {
            const content = (m as { content?: unknown }).content
            return typeof content === "string" ? content : JSON.stringify(content ?? "")
        })
        .join("\n")
}

/** The last `usage`, `provider` and `id` in a response or a stream's final chunks. */
function readTail(tail: string): Pick<ProxyRecord, "usage" | "servedBy" | "generationId"> {
    const pick = (re: RegExp): string | undefined => [...tail.matchAll(re)].at(-1)?.[1]
    const num = (re: RegExp): number | undefined => {
        const value = pick(re)
        return value === undefined ? undefined : Number(value)
    }
    const prompt = num(/"prompt_tokens"\s*:\s*(\d+)/g)
    const usage = {
        ...(prompt === undefined ? {} : { prompt }),
        ...optional("completion", num(/"completion_tokens"\s*:\s*(\d+)/g)),
        ...optional("cached", num(/"cached_tokens"\s*:\s*(\d+)/g)),
        ...optional("reasoning", num(/"reasoning_tokens"\s*:\s*(\d+)/g)),
        ...optional("cost", num(/"cost"\s*:\s*([\d.eE-]+)/g)),
    }
    return {
        ...(Object.keys(usage).length === 0 ? {} : { usage }),
        ...optional("servedBy", pick(/"provider"\s*:\s*"([^"]+)"/g)),
        ...optional("generationId", pick(/"id"\s*:\s*"(gen-[^"]+)"/g)),
    }
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
    return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }
}

function mockResponse(body: Record<string, unknown>, reply: string): Response {
    const id = `chatcmpl-mock-${Date.now()}`
    const model = String(body.model ?? "mock")
    const usage = { prompt_tokens: 0, completion_tokens: 1, total_tokens: 1 }
    if (body.stream !== true)
        return Response.json({
            id,
            object: "chat.completion",
            model,
            choices: [
                { index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" },
            ],
            usage,
        })
    const chunk = (delta: Record<string, unknown>, finish: string | null, extra = {}) =>
        `data: ${JSON.stringify({ id, object: "chat.completion.chunk", model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`
    const text =
        chunk({ role: "assistant", content: reply }, null) +
        chunk({}, "stop", { usage }) +
        "data: [DONE]\n\n"
    return new Response(text, { headers: { "content-type": "text/event-stream" } })
}

export function createProxy(options: ProxyOptions): (req: Request) => Promise<Response> {
    const now = options.now ?? Date.now
    const upstreamFetch =
        options.model === undefined ? undefined : pinnedFetch(options.model, options.fetch ?? fetch)
    let seq = 0

    return async (req) => {
        const path = new URL(req.url).pathname.replace(/^\/v1/, "")
        if (req.method === "GET" && path === "/models")
            return Response.json({
                object: "list",
                data: [{ id: options.model?.id ?? "mock", object: "model" }],
            })
        if (req.method !== "POST" || path !== "/chat/completions")
            return Response.json(
                {
                    error: {
                        message: `The bench proxy serves POST /v1/chat/completions, not ${req.method} ${path}.`,
                    },
                },
                { status: 404 },
            )

        const raw = await req.text()
        const started = now()
        let body: Record<string, unknown>
        try {
            body = JSON.parse(raw) as Record<string, unknown>
        } catch {
            return Response.json(
                { error: { message: "The request body is not JSON." } },
                { status: 400 },
            )
        }
        const messages = Array.isArray(body.messages) ? body.messages : []
        const tools = Array.isArray(body.tools) ? body.tools : []
        const base = {
            ts: new Date(started).toISOString(),
            label: options.label,
            seq: ++seq,
            stream: body.stream === true,
            modelRequested: body.model,
            bytes: {
                request: Buffer.byteLength(raw),
                system: Buffer.byteLength(systemText(messages)),
                tools: tools.length === 0 ? 0 : Buffer.byteLength(JSON.stringify(tools)),
            },
            counts: { messages: messages.length, tools: tools.length },
            body,
        }

        if (options.model === undefined || upstreamFetch === undefined) {
            await new Promise((resolve) => setTimeout(resolve, options.latencyMs ?? 0))
            options.record({
                ...base,
                mode: "mock",
                modelSent: "mock",
                status: 200,
                durationMs: now() - started,
            })
            return mockResponse(body, options.reply ?? "OK")
        }

        const sent = { ...body, model: options.model.id }
        if (sent.stream === true) sent.stream_options = { include_usage: true }
        const upstream = await upstreamFetch(`${options.model.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...(options.apiKey === undefined
                    ? {}
                    : { authorization: `Bearer ${options.apiKey}` }),
            },
            body: JSON.stringify(sent),
        })
        const model = options.model
        const reader = upstream.body?.getReader()
        let tail = ""
        let firstByteMs: number | undefined
        const decoder = new TextDecoder()
        const finish = () =>
            options.record({
                ...base,
                mode: "upstream",
                modelSent: model.id,
                ...optional("provider", model.provider),
                status: upstream.status,
                ...optional("firstByteMs", firstByteMs),
                durationMs: now() - started,
                ...readTail(tail),
            })
        const relay = new ReadableStream<Uint8Array>({
            async pull(controller) {
                const chunk = await reader?.read()
                if (chunk === undefined || chunk.done) {
                    finish()
                    controller.close()
                    return
                }
                firstByteMs ??= now() - started
                tail = (tail + decoder.decode(chunk.value, { stream: true })).slice(-USAGE_TAIL)
                controller.enqueue(chunk.value)
            },
            cancel() {
                finish()
                return reader?.cancel()
            },
        })
        return new Response(relay, {
            status: upstream.status,
            headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
        })
    }
}

if (import.meta.main) {
    const args = process.argv.slice(2)
    const flag = (name: string) => {
        const at = args.indexOf(`--${name}`)
        return at === -1 ? undefined : args[at + 1]
    }
    const label = flag("label")
    const log = flag("log")
    if (label === undefined || log === undefined) {
        console.error(
            "usage: proxy.ts --label <harness> --log <file.jsonl> (--model <roster key> | --mock [--latency ms])",
        )
        process.exit(1)
    }
    const mock = args.includes("--mock")
    const modelKey = flag("model")
    if (!mock && modelKey === undefined) {
        console.error(
            "Pass --model <roster key> to forward upstream, or --mock to answer locally.\n  hint: keys are in evals/models.json.",
        )
        process.exit(1)
    }
    const model = mock || modelKey === undefined ? undefined : loadRoster([modelKey])[0]
    const apiKey = model?.apiKeyEnv === undefined ? undefined : process.env[model.apiKeyEnv]
    if (model?.apiKeyEnv !== undefined && (apiKey === undefined || apiKey === "")) {
        console.error(`${model.apiKeyEnv} is not set.\n  hint: run with bun --env-file=.env.`)
        process.exit(1)
    }
    const port = Number(flag("port") ?? 8787)
    const handler = createProxy({
        label,
        ...optional("model", model),
        ...optional("apiKey", apiKey),
        latencyMs: Number(flag("latency") ?? 0),
        record: (entry) => appendFileSync(log, `${JSON.stringify(entry)}\n`),
    })
    // A turn can stream for minutes; Bun's 10 s default idle timeout would cut it mid-answer.
    Bun.serve({ port, hostname: flag("host") ?? "127.0.0.1", idleTimeout: 0, fetch: handler })
    console.log(
        `bench proxy · ${label} · ${model === undefined ? "mock" : `${model.id} @ ${model.provider ?? "local"}`} · :${port} → ${log}`,
    )
}
