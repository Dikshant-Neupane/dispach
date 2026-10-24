import { describe, expect, test } from "bun:test"
import {
    forContainer,
    hermesOutput,
    modelUrlFor,
    openclawReply,
    upstreamHost,
} from "../../../scripts/bench/adapters.ts"
import { loadRoster } from "../../../scripts/lib/roster.ts"

describe("contained harness adapters", () => {
    test("loopback URLs are rewritten to the host as a container sees it", () => {
        expect(forContainer("http://127.0.0.1:51234/v1")).toBe(
            "http://host.docker.internal:51234/v1",
        )
        expect(forContainer("http://localhost:8788/mcp")).toBe(
            "http://host.docker.internal:8788/mcp",
        )
        expect(forContainer("https://api.example.com/v1")).toBe("https://api.example.com/v1")
    })

    test("a container reaches the model proxy under the upstream's own host name", () => {
        // Harnesses decide things from it: Claude's cache_control is sent only to openrouter.ai, by
        // this runtime and by Hermes alike, and behind a loopback address neither sent it.
        const [hosted, local] = loadRoster(["haiku-5.5", "qwen3.5-9b-local"])
        if (hosted === undefined || local === undefined) throw new Error("roster fixture missing")
        expect(upstreamHost(hosted)).toBe("openrouter.ai")
        expect(upstreamHost(local)).toBe("host.docker.internal")
        expect(modelUrlFor("http://127.0.0.1:51234/v1", "openrouter.ai")).toBe(
            "http://openrouter.ai:51234/v1",
        )
    })

    test("a model's own turn limit survives the roster load, so a slow endpoint is not scored as failure", () => {
        // A field on a conditional spread is the shape this repo has dropped six times; read it back.
        const roster = loadRoster(["qwen3.5-9b", "gpt-6.1-sol"])
        const slow = roster.find((m) => m.key === "qwen3.5-9b")
        const fast = roster.find((m) => m.key === "gpt-6.1-sol")
        expect(slow?.turnTimeoutMs).toBe(900_000)
        expect(fast?.turnTimeoutMs).toBeUndefined()
    })

    test("the OpenClaw reply is its final visible text, however deep the version nests it", () => {
        // Its --json output, shape as measured on 2026.10.5, with log lines before the object.
        const stdout = `[agent] starting\n${JSON.stringify({
            payload: { meta: { finalAssistantVisibleText: "The server clock says **Saturday**." } },
            toolSummary: { calls: 2 },
        })}`
        expect(openclawReply(stdout)).toBe("The server clock says **Saturday**.")
        expect(openclawReply("{not json")).toBe("{not json")
    })

    test("the Hermes reply drops its session line and notices, and keeps the session id", () => {
        const out = hermesOutput({
            stdout: "  ⚠ tirith security scanner enabled but not available\nTeal.\n\nsession_id: 20261021_153732_e0cb55\n",
            stderr: "",
        })
        expect(out).toEqual({ reply: "Teal.", session: "20261021_153732_e0cb55" })
        // The id can arrive on stderr instead; the reply never includes it.
        expect(hermesOutput({ stdout: "ok\n", stderr: "session_id: abc\n" })).toEqual({
            reply: "ok",
            session: "abc",
        })
    })
})
