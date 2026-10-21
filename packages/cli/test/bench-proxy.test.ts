import { describe, expect, test } from "bun:test"
import { createProxy, type ProxyRecord } from "../../../scripts/bench/proxy.ts"
import type { RosterModel } from "../../../scripts/lib/roster.ts"

const MODEL: RosterModel = {
    key: "m",
    tier: "open-large",
    id: "vendor/model-x",
    baseUrl: "https://upstream.test/api/v1",
    apiKeyEnv: "KEY",
    provider: "vendor/fp8",
    openWeight: true,
}

const REQUEST = {
    model: "whatever-the-harness-says",
    stream: true,
    messages: [
        { role: "system", content: "You are a harness with a long system prompt." },
        { role: "user", content: "hi" },
    ],
    tools: [{ type: "function", function: { name: "kv_get", parameters: { type: "object" } } }],
}

function post(
    handler: (req: Request) => Promise<Response>,
    body: unknown,
    key = "harness-dummy-key",
) {
    return handler(
        new Request("http://proxy/v1/chat/completions", {
            method: "POST",
            headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
            body: JSON.stringify(body),
        }),
    )
}

describe("bench proxy", () => {
    test("upstream: the real key, the roster model and the pin go out; the harness's own key does not", async () => {
        const sent: { headers: Headers; body: Record<string, unknown> }[] = []
        const records: ProxyRecord[] = []
        const fake = (async (_url: unknown, init?: RequestInit) => {
            sent.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) })
            const sse =
                `data: {"id":"gen-abc","provider":"Vendor","choices":[{"delta":{"content":"hi"}}]}\n\n` +
                `data: {"id":"gen-abc","provider":"Vendor","choices":[],"usage":{"prompt_tokens":900,"completion_tokens":12,"prompt_tokens_details":{"cached_tokens":800},"completion_tokens_details":{"reasoning_tokens":5},"cost":0.00042}}\n\n` +
                "data: [DONE]\n\n"
            return new Response(sse, { headers: { "content-type": "text/event-stream" } })
        }) as typeof fetch
        const handler = createProxy({
            label: "h",
            model: MODEL,
            apiKey: "sk-real",
            record: (r) => records.push(r),
            fetch: fake,
        })

        const text = await (await post(handler, REQUEST)).text()
        expect(text).toContain('"content":"hi"')

        const [out] = sent
        expect(out?.headers.get("authorization")).toBe("Bearer sk-real")
        expect(JSON.stringify(out)).not.toContain("harness-dummy-key")
        expect(out?.body.model).toBe("vendor/model-x")
        expect(out?.body.provider).toEqual({
            only: ["vendor/fp8"],
            allow_fallbacks: false,
            require_parameters: true,
        })
        expect(out?.body.stream_options).toEqual({ include_usage: true })

        const [record] = records
        expect(record?.mode).toBe("upstream")
        expect(record?.usage).toEqual({
            prompt: 900,
            completion: 12,
            cached: 800,
            reasoning: 5,
            cost: 0.00042,
        })
        expect(record?.servedBy).toBe("Vendor")
        expect(record?.generationId).toBe("gen-abc")
        expect(record?.counts).toEqual({ messages: 2, tools: 1 })
        expect(record?.bytes.system).toBe(
            Buffer.byteLength("You are a harness with a long system prompt."),
        )
        expect(record?.bytes.tools).toBe(Buffer.byteLength(JSON.stringify(REQUEST.tools)))
        expect(record?.modelRequested).toBe("whatever-the-harness-says")
    })

    test("mock: answers in both shapes after the set latency and still records the overhead", async () => {
        const records: ProxyRecord[] = []
        let clock = 1000
        const handler = createProxy({
            label: "h",
            latencyMs: 0,
            record: (r) => records.push(r),
            now: () => (clock += 200),
        })
        const streamed = await (await post(handler, REQUEST)).text()
        expect(streamed).toContain('"content":"OK"')
        expect(streamed).toContain("data: [DONE]")
        const plain = (await (await post(handler, { ...REQUEST, stream: false })).json()) as {
            choices: { message: { content: string } }[]
        }
        expect(plain.choices[0]?.message.content).toBe("OK")
        expect(records.map((r) => r.mode)).toEqual(["mock", "mock"])
        expect(records[0]?.bytes.tools).toBeGreaterThan(0)
        expect(records.map((r) => r.seq)).toEqual([1, 2])
    })

    test("a model list is served so harnesses that probe it start", async () => {
        const handler = createProxy({ label: "h", model: MODEL, record: () => {} })
        const list = (await (await handler(new Request("http://proxy/v1/models"))).json()) as {
            data: { id: string }[]
        }
        expect(list.data[0]?.id).toBe("vendor/model-x")
    })
})
