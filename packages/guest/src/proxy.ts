import type { IncomingMessage, ServerResponse } from "node:http"
import type { Guests } from "./guests.ts"

export interface Upstream {
    /** An OpenAI-compatible base URL, without `/chat/completions`. */
    readonly baseUrl: string
    /** The model every guest call is sent to, whatever the request named. */
    readonly model: string
    /** The provider key. Lives in this process and in the outbound header, nowhere else. */
    readonly apiKey: string
}

/** A chat request is a prompt, not an upload; anything larger is not a guest's agent talking. */
const MAX_BODY_BYTES = 1_000_000
/** The `usage` block of a final chunk or a whole response. */
const USAGE = /"prompt_tokens"\s*:\s*(\d+)[\s\S]*?"completion_tokens"\s*:\s*(\d+)/
/** Enough of a stream's end to hold its last chunk, which is where `usage` arrives. */
const TAIL_BYTES = 8192

/** Errors in the OpenAI shape, because the agent on the other side parses them as a provider's. */
function fail(res: ServerResponse, status: number, code: string, message: string): void {
    res.writeHead(status, { "content-type": "application/json" })
    res.end(JSON.stringify({ error: { message, type: code, code } }))
}

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
        size += (chunk as Buffer).length
        if (size > MAX_BODY_BYTES) return undefined
        chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks)
}

/**
 * `POST /model/chat/completions`. The guest's token arrives as its bearer; the provider's key leaves
 * in its place, with the model forced and usage requested, and the response streams straight back.
 */
export async function proxyModel(
    req: IncomingMessage,
    res: ServerResponse,
    guests: Guests,
    upstream: Upstream,
): Promise<void> {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? ""
    const guest = guests.byToken(token)
    if (guest === undefined) {
        fail(
            res,
            401,
            "guest_unknown",
            "This guest session has ended. Start a new one from the website.",
        )
        return
    }
    const refusal = guests.refusal(guest)
    if (refusal !== undefined) {
        fail(res, 429, refusal.code, refusal.message)
        return
    }

    const raw = await readBody(req)
    if (raw === undefined) {
        fail(res, 413, "guest_request_too_large", "A guest model request is limited to 1 MB.")
        return
    }
    let body: Record<string, unknown>
    try {
        const parsed: unknown = JSON.parse(raw.toString("utf8"))
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
            throw new Error()
        body = parsed as Record<string, unknown>
    } catch {
        fail(res, 400, "guest_request_invalid", "The request body is not a JSON object.")
        return
    }
    body.model = upstream.model
    if (body.stream === true) body.stream_options = { include_usage: true }

    // Aborts the upstream call when the silo hangs up, so a dropped turn stops costing money.
    const abort = new AbortController()
    res.on("close", () => abort.abort())

    let response: Response
    try {
        response = await fetch(`${upstream.baseUrl.replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${upstream.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: abort.signal,
        })
    } catch (error) {
        if (!abort.signal.aborted)
            fail(
                res,
                502,
                "guest_upstream_unreachable",
                `The model provider did not answer: ${(error as Error).message}`,
            )
        return
    }

    res.writeHead(response.status, {
        "content-type": response.headers.get("content-type") ?? "application/json",
    })
    let tail = ""
    let bytes = 0
    try {
        for await (const chunk of response.body ?? []) {
            const buffer = Buffer.from(chunk as Uint8Array)
            bytes += buffer.length
            tail = (tail + buffer.toString("utf8")).slice(-TAIL_BYTES)
            res.write(buffer)
        }
    } catch {
        // The silo hung up mid-stream; charge for what was read.
    } finally {
        res.end()
        const usage = tail.match(USAGE)
        // ponytail: a provider that reports no usage is charged by bytes at ~4 per token, biased high.
        const tokens =
            usage === null
                ? Math.ceil((raw.length + bytes) / 4)
                : Number(usage[1]) + Number(usage[2])
        guests.charge(guest, tokens)
    }
}
