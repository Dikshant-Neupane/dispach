import { describe, expect, test } from "bun:test"
import type { ProxyRecord } from "../../../scripts/bench/proxy.ts"
import { type Harness, MAX_RETRIES, rateLimited, runTask } from "../../../scripts/bench/run.ts"
import { TASKS } from "../../../scripts/bench/tasks.ts"
import { createToolServer } from "../../../scripts/bench/tools-server.ts"
import { loadRoster } from "../../../scripts/lib/roster.ts"

const [model] = loadRoster(["gpt-6-luna"])
const task = TASKS.find((t) => t.id === "chain-order-notify")
if (model === undefined || task === undefined) throw new Error("fixture missing")

const record = (status: number, cost = 0.001): ProxyRecord =>
    ({
        status,
        usage: { prompt: 100, completion: 10, cost },
        generationId: "gen-x",
    }) as unknown as ProxyRecord

/** A harness that plays the oracle when `works`, and otherwise replies without calling anything. */
function fake(
    server: ReturnType<typeof createToolServer>,
    log: ProxyRecord[],
    plan: ("429" | "ok")[],
): Harness {
    return {
        name: "fake",
        prepare: async () => {},
        reset: async () => {},
        async turn() {
            const step = plan.shift() ?? "ok"
            if (step === "429") {
                log.push(record(429))
                return { reply: "rate limited", ok: true, detail: "" }
            }
            log.push(record(200))
            for (const [name, args] of task?.oracle.calls ?? []) {
                await server.fetch(
                    new Request("http://bench.test/mcp", {
                        method: "POST",
                        body: JSON.stringify({
                            jsonrpc: "2.0",
                            id: 1,
                            method: "tools/call",
                            params: { name, arguments: args },
                        }),
                    }),
                )
            }
            return { reply: task?.oracle.reply ?? "", ok: true, detail: "" }
        },
    }
}

function setup(plan: ("429" | "ok")[]) {
    const server = createToolServer()
    const log: ProxyRecord[] = []
    const harness = fake(server, log, plan)
    const takeRecords = () => {
        const taken = log.splice(0)
        return taken
    }
    return { server, harness, takeRecords }
}

describe("bench runner", () => {
    test("a passing run is graded on the world and carries the proxy's numbers", async () => {
        const { server, harness, takeRecords } = setup(["ok"])
        const row = await runTask({
            harness,
            model,
            task,
            repeat: 1,
            server,
            takeRecords,
            sleep: async () => {},
        })
        expect(row).toMatchObject({
            pass: true,
            retries: 0,
            modelCalls: 1,
            toolCalls: 2,
            promptTokens: 100,
        })
        expect(row.generationIds).toEqual(["gen-x"])
    })

    test("a 429 that failed the run is re-run and counted, never scored", async () => {
        const { server, harness, takeRecords } = setup(["429", "429", "ok"])
        const row = await runTask({
            harness,
            model,
            task,
            repeat: 1,
            server,
            takeRecords,
            sleep: async () => {},
        })
        expect(row).toMatchObject({ pass: true, retries: 2, modelCalls: 1 })
    })

    test("past the retry budget the failure is kept and the retries reported", async () => {
        const { server, harness, takeRecords } = setup(Array(MAX_RETRIES + 1).fill("429"))
        const row = await runTask({
            harness,
            model,
            task,
            repeat: 1,
            server,
            takeRecords,
            sleep: async () => {},
        })
        expect(row).toMatchObject({ pass: false, retries: MAX_RETRIES })
    })

    test("a harness that exits non-zero scores 0 and stays a row", async () => {
        const server = createToolServer()
        const harness: Harness = {
            name: "broken",
            prepare: async () => {},
            reset: async () => {},
            turn: async () => ({ reply: "", ok: false, detail: "boom" }),
        }
        const row = await runTask({
            harness,
            model,
            task,
            repeat: 1,
            server,
            takeRecords: () => [],
            sleep: async () => {},
        })
        expect(row).toMatchObject({ pass: false, errored: true, reason: "harness error: boom" })
    })

    test("OpenRouter's in-flight 402 is throttling; a 402 for no credit is not", () => {
        const tail = (reason: string) =>
            ({
                status: 402,
                responseTail: `{"error":{"code":402,"metadata":{"reason":"${reason}"}}}`,
            }) as unknown as ProxyRecord
        expect(rateLimited([tail("in_flight_budget_exhausted")])).toBe(true)
        expect(rateLimited([tail("insufficient_credits")])).toBe(false)
        expect(rateLimited([record(200)])).toBe(false)
        // An upstream the proxy could not reach is re-run, not scored.
        expect(rateLimited([record(0)])).toBe(true)
    })

    test("every attempt starts from a reset harness, a re-run after a 429 included", async () => {
        const { server, harness, takeRecords } = setup(["429", "ok"])
        const order: string[] = []
        const traced: Harness = {
            ...harness,
            reset: async () => {
                order.push("reset")
            },
            turn: async (text, session) => {
                order.push("turn")
                return harness.turn(text, session)
            },
        }
        await runTask({
            harness: traced,
            model,
            task,
            repeat: 1,
            server,
            takeRecords,
            sleep: async () => {},
        })
        expect(order).toEqual(["reset", "turn", "reset", "turn"])
    })
})
