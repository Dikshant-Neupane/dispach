/**
 * The observation budget is sized from the window when the manifest does not set one (0.2.0).
 *
 * A flat 2,000 cut an 11k-token handbook in the middle on a 1M-window model, where the answer was, and
 * the model reported "the result was cut off" instead of answering (`evals/harness/runs/baseline-
 * aae8fe4`, long-handbook). Asserted on the model's second request, because the value is threaded from
 * the manifest through the agent into the executor and every layer can be right while one drops it.
 */

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BRAND } from "../src/brand.ts"
import { observationBudget } from "../src/context/budget.ts"
import type { FetchLike } from "../src/model/provider.ts"
import { Runtime } from "../src/runtime/runtime.ts"
import type { ToolProviderFactory } from "../src/tools/types.ts"
import { describe, expect, test } from "./_harness.ts"

// About 10k tokens, with the line that matters in the middle.
const DOCUMENT = `${"policy line ".repeat(1700)}MEAL-LIMIT-75 ${"policy line ".repeat(1700)}`

const provider: ToolProviderFactory = () => ({
    id: "docs",
    resolve: (slugs) =>
        Promise.resolve(
            slugs.includes("read_doc")
                ? [
                      {
                          spec: {
                              slug: "read_doc",
                              provider: "docs",
                              summary: "Reads the handbook.",
                              whenToUse: "testing",
                              whenNotToUse: "not testing",
                              mutating: false,
                              tags: [],
                              parameters: { type: "object", properties: {} },
                              trust: "trusted",
                              trustReason: "a test fixture",
                          },
                          handler: () => DOCUMENT,
                      },
                  ]
                : [],
        ),
})

function sse(content: string): Response {
    const body = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`
    return new Response(body, { headers: { "content-type": "text/event-stream" } })
}

async function secondRequest(window: number, configured?: number): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "obs-budget-"))
    const manifest = join(dir, "agent.yaml")
    writeFileSync(
        manifest,
        `apiVersion: ${BRAND.apiVersion}
id: reader
model:
  main:
    id: gpt-4o-mini
    baseUrl: https://api.example.com/v1
    apiKeyEnv: MODEL_API_KEY
context:
  window: ${window}
  reserveOutput: 512${configured === undefined ? "" : `\n  observationMaxTokens: ${configured}`}
tools:
  providers:
    docs: {}
  pinned: [read_doc]
limits:
  maxSteps: 3
  turnTimeoutMs: 5000
`,
    )
    const bodies: string[] = []
    const fetch: FetchLike = async (_url, init) => {
        bodies.push(String(init?.body ?? ""))
        return sse(bodies.length === 1 ? "ACTION: read_doc\nEND" : "Done.")
    }
    const runtime = await Runtime.create({
        agents: [manifest],
        env: { MODEL_API_KEY: "k" },
        fetch,
        store: ":memory:",
        toolProviders: { docs: provider },
    })
    await runtime.agent("reader")?.send("what is the meal limit?")
    await runtime.stop()
    return bodies[1] ?? ""
}

describe("the observation budget follows the window", () => {
    test("a quarter of the window, between 2,000 and 32,000, unless the manifest pins one", () => {
        expect(observationBudget(undefined, 4_096)).toBe(2_000)
        expect(observationBudget(undefined, 8_192)).toBe(2_048)
        // gpt-oss-20b's window: 5% gave 6,553 and cut an 11k-token file it then could not answer from.
        expect(observationBudget(undefined, 65_536)).toBe(16_384)
        expect(observationBudget(undefined, 131_072)).toBe(32_000)
        expect(observationBudget(undefined, 1_048_576)).toBe(32_000)
        expect(observationBudget(500, 1_048_576)).toBe(500)
    })

    test("a large window reads the whole document, so the answer in its middle arrives", async () => {
        expect(await secondRequest(1_048_576)).toContain("MEAL-LIMIT-75")
    })

    test("a small window still cuts it, and an explicit setting is honoured on a large one", async () => {
        expect(await secondRequest(8_192)).not.toContain("MEAL-LIMIT-75")
        expect(await secondRequest(1_048_576, 2_000)).not.toContain("MEAL-LIMIT-75")
    })
})
