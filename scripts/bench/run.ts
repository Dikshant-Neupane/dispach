#!/usr/bin/env bun
/**
 * Runs one harness × one roster model over the task suite and appends one JSONL row per run.
 *
 *   bun --env-file=.env scripts/bench/run.ts --harness dispach-nlt --model gpt-6-luna --repeats 5 \
 *       --out evals/harness/runs/dispach-nlt.gpt-6-luna.jsonl [--tasks single-now,chain-edit-json]
 *
 * The tool server and the recording proxy run in this process, so every row carries the world's
 * final state, the grade, and the proxy's own count of model calls, tokens and cost for that run.
 * A run that hit an upstream 429 and did not pass is re-run after a backoff, and the row says how
 * many times: rate limiting is the provider's noise, never the harness's failure. Any other error
 * scores 0 and stays in the denominator.
 */
import { appendFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadRoster, type RosterModel } from "../lib/roster.ts"
import { HARNESSES } from "./adapters.ts"
import { createProxy, type ProxyRecord } from "./proxy.ts"
import { TASKS, type Task } from "./tasks.ts"
import { createToolServer } from "./tools-server.ts"

export interface RunRow {
    readonly harness: string
    readonly model: string
    readonly provider?: string
    readonly task: string
    readonly category: string
    readonly repeat: number
    readonly pass: boolean
    readonly reason?: string
    readonly reply: string
    /** The harness exited non-zero or timed out on some turn. */
    readonly errored: boolean
    readonly retries: number
    readonly wallMs: number
    readonly toolCalls: number
    readonly modelCalls: number
    readonly promptTokens: number
    readonly completionTokens: number
    readonly cost: number
    readonly generationIds: readonly string[]
    readonly at: string
}

/** What a harness adapter does: set itself up once, then answer one turn of a conversation. */
export interface Harness {
    readonly name: string
    prepare(context: HarnessContext): Promise<void>
    turn(text: string, session: string): Promise<{ reply: string; ok: boolean; detail: string }>
    /**
     * Put the harness back exactly as `prepare` left it: memory, sessions, notes. Called before every
     * attempt, so a repeat never recalls itself. In the `309fdf8` head-to-head one agent served all 125
     * runs of an arm, and repeat 3 of a task was handed repeats 1 and 2 of the same question as memory.
     */
    reset(): Promise<void>
    /** Tear down what `prepare` started, such as a container. */
    close?(): Promise<void>
}

export interface HarnessContext {
    readonly model: RosterModel
    /** OpenAI-compatible base URL of the recording proxy, ending at /v1. */
    readonly modelBaseUrl: string
    /** Streamable HTTP MCP endpoint of the tool server. */
    readonly mcpUrl: string
    /** A fresh scratch directory this harness may own. */
    readonly dir: string
}

export const MAX_RETRIES = 4

/**
 * The provider throttled this run: a 429, or OpenRouter's 402 for too many requests in flight at
 * once (`in_flight_budget_exhausted`, measured with eight arms in parallel). Both are the provider's
 * noise, never the harness's failure. A 402 for an actual lack of credit is not this, and is scored.
 */
export function rateLimited(records: readonly ProxyRecord[]): boolean {
    return records.some(
        (r) =>
            r.status === 429 ||
            // The proxy could not reach the upstream at all (status 0): the network's noise, not the harness's.
            r.status === 0 ||
            (r.status === 402 && (r.responseTail ?? "").includes("in_flight_budget_exhausted")),
    )
}

/** One task, start to finish, with 429 re-runs. `reset` and `records` are the run's world and log. */
export async function runTask(options: {
    readonly harness: Harness
    readonly model: RosterModel
    readonly task: Task
    readonly repeat: number
    readonly server: ReturnType<typeof createToolServer>
    /** Drains the proxy records made since the last call. */
    readonly takeRecords: () => ProxyRecord[]
    readonly sleep?: (ms: number) => Promise<void>
}): Promise<RunRow> {
    const { harness, model, task, repeat, server } = options
    const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    let retries = 0
    for (;;) {
        await harness.reset()
        server.reset(task.world)
        options.takeRecords()
        const session = `t${TASKS.indexOf(task)}r${repeat}a${retries}`
        const started = Date.now()
        let reply = ""
        let errored = false
        let detail = ""
        for (const text of task.turns) {
            const answer = await harness.turn(text, session)
            reply = answer.reply
            if (!answer.ok) {
                errored = true
                detail = answer.detail
                break
            }
        }
        const wallMs = Date.now() - started
        const records = options.takeRecords()
        const state = server.state()
        const failure = errored
            ? `harness error: ${detail.slice(0, 300)}`
            : task.grade(state, reply)
        if (failure !== undefined && rateLimited(records) && retries < MAX_RETRIES) {
            retries += 1
            // OpenRouter asks for 120 s after an in-flight 402; the 429 backoff is shorter.
            await sleep(
                Math.max(5_000 * 2 ** retries, records.some((r) => r.status === 402) ? 120_000 : 0),
            )
            continue
        }
        const sum = (pick: (r: ProxyRecord) => number | undefined) =>
            records.reduce((total, r) => total + (pick(r) ?? 0), 0)
        return {
            harness: harness.name,
            model: model.key,
            ...(model.provider === undefined ? {} : { provider: model.provider }),
            task: task.id,
            category: task.category,
            repeat,
            pass: failure === undefined,
            ...(failure === undefined ? {} : { reason: failure }),
            reply,
            errored,
            retries,
            wallMs,
            toolCalls: state.calls.length,
            modelCalls: records.length,
            promptTokens: sum((r) => r.usage?.prompt),
            completionTokens: sum((r) => r.usage?.completion),
            cost: sum((r) => r.usage?.cost),
            generationIds: records.flatMap((r) =>
                r.generationId === undefined ? [] : [r.generationId],
            ),
            at: new Date(started).toISOString(),
        }
    }
}

if (import.meta.main) {
    const args = process.argv.slice(2)
    const flag = (name: string) => {
        const at = args.indexOf(`--${name}`)
        return at === -1 ? undefined : args[at + 1]
    }
    const harnessName = flag("harness") ?? ""
    const harness = HARNESSES[harnessName]
    const modelKey = flag("model")
    const out = flag("out")
    if (harness === undefined || modelKey === undefined || out === undefined) {
        console.error(
            `usage: run.ts --harness <${Object.keys(HARNESSES).join("|")}> --model <roster key> --out <file.jsonl> [--log <raw.jsonl>] [--repeats n | --repeat n] [--tasks a,b]`,
        )
        process.exit(1)
    }
    const [model] = loadRoster([modelKey])
    if (model === undefined) process.exit(1)
    const apiKey = model.apiKeyEnv === undefined ? undefined : process.env[model.apiKeyEnv]
    if (model.apiKeyEnv !== undefined && !apiKey) {
        console.error(`${model.apiKeyEnv} is not set.\n  hint: run with bun --env-file=.env.`)
        process.exit(1)
    }
    const only = flag("tasks")?.split(",")
    const tasks = only === undefined ? TASKS : TASKS.filter((t) => only.includes(t.id))
    const repeats = Number(flag("repeats") ?? 1)
    // One repeat only, so a slow model's repeats can run as separate processes, each with its own world.
    // Rows carry the same repeat number either way, so shards merge into the arm they came from.
    const only1 = flag("repeat") === undefined ? undefined : Number(flag("repeat"))
    const log = flag("log")
    let current = ""

    const server = createToolServer()
    let records: ProxyRecord[] = []
    const proxy = createProxy({
        label: harness.name,
        model,
        ...(apiKey === undefined ? {} : { apiKey }),
        record: (r) => {
            records.push(r)
            // The raw evidence: every request and response tail, tagged with the run it belongs to.
            if (log !== undefined)
                appendFileSync(log, `${JSON.stringify({ run: current, ...r })}\n`)
        },
    })
    const tools = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 0, fetch: server.fetch })
    const models = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 0, fetch: proxy })
    const dir = mkdtempSync(join(tmpdir(), `bench-${harness.name}-`))
    await harness.prepare({
        model,
        modelBaseUrl: `http://127.0.0.1:${models.port}/v1`,
        mcpUrl: `http://127.0.0.1:${tools.port}/mcp`,
        dir,
    })

    // ponytail: sequential, because the tool server holds one world; parallel runs need a world per session.
    let passed = 0
    let total = 0
    try {
        for (let repeat = only1 ?? 1; repeat <= (only1 ?? repeats); repeat += 1) {
            for (const task of tasks) {
                current = `${task.id}#${repeat}`
                const row = await runTask({
                    harness,
                    model,
                    task,
                    repeat,
                    server,
                    takeRecords: () => {
                        const taken = records
                        records = []
                        return taken
                    },
                })
                appendFileSync(out, `${JSON.stringify(row)}\n`)
                total += 1
                if (row.pass) passed += 1
                console.log(
                    `${row.pass ? "pass" : "FAIL"}  ${task.id.padEnd(24)} r${repeat}  ${row.modelCalls} calls  ${row.wallMs} ms  $${row.cost.toFixed(5)}${row.retries > 0 ? `  (${row.retries} 429 retries)` : ""}${row.reason === undefined ? "" : `  — ${row.reason}`}`,
                )
            }
        }
    } finally {
        await harness.close?.()
    }
    console.log(`${harness.name} · ${model.key}: ${passed}/${total} passed → ${out}`)
    tools.stop(true)
    models.stop(true)
}
