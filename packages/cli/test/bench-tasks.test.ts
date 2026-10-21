import { describe, expect, test } from "bun:test"
import { TASKS } from "../../../scripts/bench/tasks.ts"
import { createToolServer } from "../../../scripts/bench/tools-server.ts"

async function replay(task: (typeof TASKS)[number]) {
    const server = createToolServer(task.world)
    let id = 0
    for (const [name, args] of task.oracle.calls) {
        id += 1
        await server.fetch(
            new Request("http://bench.test/mcp", {
                method: "POST",
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id,
                    method: "tools/call",
                    params: { name, arguments: args },
                }),
            }),
        )
    }
    return server.state()
}

describe("bench task suite", () => {
    test("25 tasks, unique ids, every category represented", () => {
        expect(TASKS).toHaveLength(25)
        expect(new Set(TASKS.map((t) => t.id)).size).toBe(TASKS.length)
        expect(new Set(TASKS.map((t) => t.category))).toEqual(
            new Set(["single", "chain", "recall", "abstention", "recovery", "long"]),
        )
    })

    for (const task of TASKS) {
        test(`${task.id}: the oracle passes, and doing nothing fails`, async () => {
            expect(task.grade(await replay(task), task.oracle.reply)).toBeUndefined()
            expect(task.grade(createToolServer(task.world).state(), "")).toBeDefined()
        })
    }
})
