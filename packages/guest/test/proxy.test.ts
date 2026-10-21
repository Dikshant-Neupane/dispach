import { afterEach, describe, expect, test } from "bun:test"
import { createServer, type IncomingHttpHeaders, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { Guests } from "../src/guests.ts"
import { createBroker } from "../src/server.ts"

const KEY = "sk-real-provider-key"
const servers: Server[] = []

interface Seen {
    headers: IncomingHttpHeaders
    body: Record<string, unknown>
}

/** A provider that records what reached it and streams a reply ending in a usage chunk. */
async function provider(options: { usage?: boolean } = {}): Promise<{ url: string; seen: Seen[] }> {
    const seen: Seen[] = []
    const server = createServer(async (req, res) => {
        let raw = ""
        for await (const chunk of req) raw += chunk
        seen.push({ headers: req.headers, body: JSON.parse(raw) as Record<string, unknown> })
        res.writeHead(200, { "content-type": "text/event-stream" })
        res.write(`data: {"choices":[{"delta":{"content":"hi"}}],"usage":null}\n\n`)
        if (options.usage !== false)
            res.write(
                `data: {"choices":[],"usage":{"prompt_tokens":1200,"prompt_tokens_details":{"cached_tokens":1000},"completion_tokens":34,"total_tokens":1234}}\n\n`,
            )
        res.end("data: [DONE]\n\n")
    })
    return { url: await listen(server), seen }
}

async function listen(server: Server): Promise<string> {
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function broker(upstream: string, guests: Guests): Promise<string> {
    return listen(
        createBroker({
            guests,
            upstream: { baseUrl: upstream, model: "cheap-model", apiKey: KEY },
        }),
    )
}

function call(base: string, token: string, body: Record<string, unknown> = {}): Promise<Response> {
    return fetch(`${base}/model/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
            model: "most-expensive-model",
            stream: true,
            messages: [],
            ...body,
        }),
    })
}

afterEach(() => {
    for (const server of servers.splice(0)) server.close()
})

describe("model proxy", () => {
    test("the provider sees the real key and the forced model, never the guest's token", async () => {
        const up = await provider()
        const guests = new Guests({ perGuest: 1e6, daily: 1e9 })
        const guest = guests.add("g1")
        const res = await call(await broker(up.url, guests), guest.token)
        const text = await res.text()

        expect(res.status).toBe(200)
        expect(text).toContain('"content":"hi"')
        expect(text).not.toContain(KEY)
        const [request] = up.seen
        expect(request?.headers.authorization).toBe(`Bearer ${KEY}`)
        expect(JSON.stringify(request)).not.toContain(guest.token)
        expect(request?.body.model).toBe("cheap-model")
        expect(request?.body.stream_options).toEqual({ include_usage: true })
    })

    test("a call is charged what the provider reported", async () => {
        const up = await provider()
        const guests = new Guests({ perGuest: 1e6, daily: 1e9 })
        const guest = guests.add("g1")
        await (await call(await broker(up.url, guests), guest.token)).text()
        expect(guest.tokensUsed).toBe(1234)
    })

    test("a provider that reports no usage is charged by bytes rather than not at all", async () => {
        const up = await provider({ usage: false })
        const guests = new Guests({ perGuest: 1e6, daily: 1e9 })
        const guest = guests.add("g1")
        await (await call(await broker(up.url, guests), guest.token)).text()
        expect(guest.tokensUsed).toBeGreaterThan(0)
    })

    test("an unknown token is refused before anything reaches the provider", async () => {
        const up = await provider()
        const res = await call(
            await broker(up.url, new Guests({ perGuest: 1e6, daily: 1e9 })),
            "dguest_forged",
        )
        expect(res.status).toBe(401)
        expect(up.seen).toHaveLength(0)
    })

    test("a guest past its budget is refused with a message its terminal can show", async () => {
        const up = await provider()
        const guests = new Guests({ perGuest: 1000, daily: 1e9 })
        const guest = guests.add("g1")
        const base = await broker(up.url, guests)
        await (await call(base, guest.token)).text()
        const res = await call(base, guest.token)
        const body = (await res.json()) as { error: { code: string; message: string } }
        expect(res.status).toBe(429)
        expect(body.error.code).toBe("guest_budget_exhausted")
        expect(body.error.message).toContain("1,000-token budget")
        expect(up.seen).toHaveLength(1)
    })

    test("the daily budget is shared by every guest and resets at UTC midnight", async () => {
        let now = Date.parse("2026-10-21T23:59:00Z")
        const up = await provider()
        const guests = new Guests({ perGuest: 1e6, daily: 1000 }, () => now)
        const base = await broker(up.url, guests)
        await (await call(base, guests.add("a").token)).text()
        const second = guests.add("b")
        expect((await call(base, second.token)).status).toBe(429)
        now = Date.parse("2026-10-22T00:00:01Z")
        expect((await call(base, second.token)).status).toBe(200)
    })
})
