#!/usr/bin/env bun
/**
 * Summarises one run directory of `run.ts` rows into `results.json` and a markdown table.
 *
 *   bun scripts/bench/report.ts evals/harness/runs/after-ac5dcc5 [--against evals/harness/runs/baseline-aae8fe4]
 *
 * One arm per `<dialect>.<model>.jsonl`. Errored runs stay in the denominator (they scored 0), so
 * the pass rate is over every run attempted. The interval is Wilson's at 95%: with n=125 a normal
 * approximation is fine in the middle and wrong near 0 and 1, which is where single tasks live.
 * `--against` adds per-arm, per-category and per-task deltas, matched by arm name.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { provenance } from "../lib/provenance.ts"
import type { RunRow } from "./run.ts"

export interface Rate {
    readonly pass: number
    readonly n: number
    readonly rate: number
    readonly low: number
    readonly high: number
}

export interface Arm {
    readonly arm: string
    readonly harness: string
    readonly model: string
    readonly provider?: string
    readonly overall: Rate
    readonly errored: number
    /** Rows still rate-limited after every retry: left out of every rate, since they measure the provider. */
    readonly throttled: number
    readonly retries: number
    readonly cost: number
    readonly promptTokens: number
    readonly completionTokens: number
    readonly medianWallMs: number
    readonly categories: Readonly<Record<string, Rate>>
    readonly tasks: Readonly<Record<string, Rate>>
}

/** Wilson score interval at 95%. */
export function wilson(pass: number, n: number): Rate {
    if (n === 0) return { pass, n, rate: 0, low: 0, high: 0 }
    const z = 1.96
    const p = pass / n
    const denom = 1 + (z * z) / n
    const centre = (p + (z * z) / (2 * n)) / denom
    const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom
    const round = (x: number) => Number(x.toFixed(4))
    return { pass, n, rate: round(p), low: round(centre - half), high: round(centre + half) }
}

function rateBy(rows: readonly RunRow[], key: (row: RunRow) => string): Record<string, Rate> {
    const groups = new Map<string, RunRow[]>()
    for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row])
    return Object.fromEntries(
        [...groups].map(([k, g]) => [k, wilson(g.filter((r) => r.pass).length, g.length)]),
    )
}

export function summarise(arm: string, rows: readonly RunRow[]): Arm {
    const first = rows[0]
    if (first === undefined) throw new Error(`${arm} has no rows.\n  hint: did run.ts finish?`)
    // Cost and tokens count every row, since they were spent; rates count only what was measured.
    const sum = (f: (r: RunRow) => number) => rows.reduce((t, r) => t + f(r), 0)
    const scored = rows.filter((r) => r.throttled !== true)
    const walls = scored.map((r) => r.wallMs).sort((a, b) => a - b)
    return {
        arm,
        harness: first.harness,
        model: first.model,
        ...(first.provider === undefined ? {} : { provider: first.provider }),
        overall: wilson(scored.filter((r) => r.pass).length, scored.length),
        errored: scored.filter((r) => r.errored).length,
        throttled: rows.length - scored.length,
        retries: sum((r) => r.retries),
        cost: Number(sum((r) => r.cost).toFixed(4)),
        promptTokens: sum((r) => r.promptTokens),
        completionTokens: sum((r) => r.completionTokens),
        medianWallMs: walls[Math.floor(walls.length / 2)] ?? 0,
        categories: rateBy(scored, (r) => r.category),
        tasks: rateBy(scored, (r) => r.task),
    }
}

/**
 * The arm a results file belongs to: a slow model's repeats run as `<arm>.r<n>.jsonl` shards and are one
 * arm. `undefined` for the raw request log and for the originals a throttled re-run replaced.
 */
export function armOf(name: string): string | undefined {
    if (!name.endsWith(".jsonl") || /\.(raw|throttled-orig)\.jsonl$/.test(name)) return undefined
    return basename(name, ".jsonl").replace(/\.r\d+$/, "")
}

export function load(dir: string): Arm[] {
    const files = new Map<string, string[]>()
    for (const name of readdirSync(dir).sort()) {
        const arm = armOf(name)
        if (arm !== undefined) files.set(arm, [...(files.get(arm) ?? []), name])
    }
    return [...files].map(([arm, names]) =>
        summarise(
            arm,
            names.flatMap((name) =>
                readFileSync(join(dir, name), "utf8")
                    .split("\n")
                    .filter((line) => line.trim() !== "")
                    .map((line) => JSON.parse(line) as RunRow),
            ),
        ),
    )
}

/** Percentage points, `after − before`, for every key the two share. */
function deltas(
    after: Readonly<Record<string, Rate>>,
    before: Readonly<Record<string, Rate>>,
): Record<string, number> {
    return Object.fromEntries(
        Object.keys(after)
            .filter((k) => before[k] !== undefined)
            .map((k) => [
                k,
                Math.round(((after[k]?.rate ?? 0) - (before[k]?.rate ?? 0)) * 1000) / 10,
            ]),
    )
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`

if (import.meta.main) {
    const args = process.argv.slice(2)
    const dir = args[0]
    const at = args.indexOf("--against")
    const againstDir = at === -1 ? undefined : args[at + 1]
    if (dir === undefined || (at !== -1 && againstDir === undefined)) {
        console.error("usage: report.ts <run dir> [--against <run dir>]")
        process.exit(2)
    }
    const arms = load(dir)
    const before = againstDir === undefined ? [] : load(againstDir)
    const compared = arms.map((arm) => {
        const prior = before.find((b) => b.arm === arm.arm)
        return prior === undefined
            ? arm
            : {
                  ...arm,
                  against: {
                      dir: againstDir,
                      overallPp: Math.round((arm.overall.rate - prior.overall.rate) * 1000) / 10,
                      categoriesPp: deltas(arm.categories, prior.categories),
                      tasksPp: deltas(arm.tasks, prior.tasks),
                  },
              }
    })
    writeFileSync(
        join(dir, "results.json"),
        `${JSON.stringify({ ...provenance(), arms: compared }, null, 4)}\n`,
    )
    console.log(
        "| Arm | Pass | 95% CI | Errored | Cost | Prompt tokens |" +
            (before.length ? " Δ vs before |" : ""),
    )
    console.log(`| --- | --- | --- | --- | --- | --- |${before.length ? " --- |" : ""}`)
    for (const arm of compared) {
        const d =
            "against" in arm
                ? ` ${arm.against.overallPp > 0 ? "+" : ""}${arm.against.overallPp}pp |`
                : before.length
                  ? " — |"
                  : ""
        console.log(
            `| ${arm.arm} | ${arm.overall.pass}/${arm.overall.n} (${pct(arm.overall.rate)}) | ${pct(arm.overall.low)}–${pct(arm.overall.high)} | ${arm.errored} | $${arm.cost.toFixed(2)} | ${arm.promptTokens.toLocaleString("en")} |${d}`,
        )
    }
}
