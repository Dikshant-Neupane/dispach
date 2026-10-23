import { describe, expect, test } from "bun:test"
import { armOf, summarise, wilson } from "../../../scripts/bench/report.ts"
import type { RunRow } from "../../../scripts/bench/run.ts"

const row = (task: string, pass: boolean, errored = false): RunRow => ({
    harness: "h",
    model: "m",
    task,
    category: task.split("-")[0] ?? "",
    repeat: 1,
    pass,
    reply: "",
    errored,
    retries: 0,
    wallMs: 1000,
    toolCalls: 0,
    modelCalls: 1,
    promptTokens: 10,
    completionTokens: 1,
    cost: 0.001,
    generationIds: [],
    at: "2026-10-21T00:00:00.000Z",
})

describe("bench report", () => {
    test("Wilson's interval matches values worked by hand", () => {
        // 88/125 → 0.704, interval 0.619–0.777 (by hand: centre 0.6979, half-width 0.0791).
        const r = wilson(88, 125)
        expect(r.rate).toBe(0.704)
        expect(r.low).toBeCloseTo(0.619, 3)
        expect(r.high).toBeCloseTo(0.777, 3)
        // At the edge it stays inside [0, 1] where the normal one collapses to a point.
        expect(wilson(5, 5).low).toBeCloseTo(0.5655, 4)
        expect(wilson(0, 5).high).toBeCloseTo(0.4345, 4)
    })

    test("an errored run stays in the denominator", () => {
        const arm = summarise("x", [row("single-a", true), row("single-a", false, true)])
        expect(arm.overall.n).toBe(2)
        expect(arm.overall.rate).toBe(0.5)
        expect(arm.errored).toBe(1)
        expect(arm.categories.single?.n).toBe(2)
    })

    test("a throttled row is counted apart and never scored", () => {
        const arm = summarise("x", [
            row("single-a", true),
            { ...row("single-a", false), throttled: true },
        ])
        expect(arm.overall).toMatchObject({ pass: 1, n: 1 })
        expect(arm.throttled).toBe(1)
        expect(arm.tasks["single-a"]?.n).toBe(1)
        // It was still paid for.
        expect(arm.cost).toBe(0.002)
    })

    test("shards are one arm; the raw log and replaced originals are no arm", () => {
        expect(armOf("nlt.qwen3.5-9b.r3.jsonl")).toBe("nlt.qwen3.5-9b")
        expect(armOf("native.glm-5.3.jsonl")).toBe("native.glm-5.3")
        expect(armOf("native.glm-5.3.raw.jsonl")).toBeUndefined()
        expect(armOf("native.gemma4-26b-a4b.throttled-orig.jsonl")).toBeUndefined()
        expect(armOf("results.json")).toBeUndefined()
    })
})
