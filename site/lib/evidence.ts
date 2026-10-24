import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * The landing page's numbers, read from the committed results at build time so the page cannot
 * say something `evals/` does not. Each figure has a row in `evals/CLAIMS.md`.
 */
const read = <T>(path: string): T =>
    JSON.parse(readFileSync(join(process.cwd(), "..", path), "utf8")) as T

const boot = read<{ processMs: { median: number }; machine: { cpu: string } }>(
    "evals/boot/results.json",
)
const tenancy = read<{ results: Record<string, { median: { idleRssKb: number } }> }>(
    "evals/tenancy/results.json",
)
const tools = read<{
    results: {
        id: string
        nlt: { summary: { accuracy: number } }
        native: { summary: { accuracy: number } }
    }[]
}>("evals/tools/results.json")

interface BenchCell {
    pass: number
    n: number
    low: number
    high: number
    cost: number
    measured: string
    paused?: true
}
interface BenchModel {
    key: string
    name: string
    native?: BenchCell
    nlt?: BenchCell
    hermes?: BenchCell
    openclaw?: BenchCell
}
const bench = read<{
    tasks: number
    repeats: number
    sweep: { commit: string }
    rivals: Record<"hermes" | "openclaw", { name: string; version: string }>
    models: BenchModel[]
}>("evals/harness/summary.json")

/** The models measured on all three harnesses, and what the landing page says about them. */
const h2h = bench.models.flatMap((m) =>
    m.native && m.hermes && m.openclaw
        ? [{ name: m.name, dispach: m.native, hermes: m.hermes, openclaw: m.openclaw }]
        : [],
)

export const benchmark = {
    runs: bench.tasks * bench.repeats,
    tasks: bench.tasks,
    repeats: bench.repeats,
    commit: bench.sweep.commit,
    rivals: bench.rivals,
    rows: h2h,
    perfect: h2h.filter((r) => r.dispach.pass === r.dispach.n).length,
    atLeastHermes: h2h.filter((r) => r.dispach.pass >= r.hermes.pass).length,
    cheapest: h2h.filter((r) => r.dispach.cost < Math.min(r.hermes.cost, r.openclaw.cost)).length,
    openclawLast: h2h.every((r) => r.openclaw.pass < Math.min(r.dispach.pass, r.hermes.pass)),
}

export const evidence = {
    bootMs: Math.round(boot.processMs.median),
    bootMachine: boot.machine.cpu,
    agents: 100,
    idleMiB: Math.round((tenancy.results["100"]?.median.idleRssKb ?? 0) / 1024),
    dialect: tools.results.map((r) => ({
        model: r.id,
        nlt: Math.round(r.nlt.summary.accuracy * 1000) / 10,
        native: Math.round(r.native.summary.accuracy * 1000) / 10,
    })),
    version: read<{ version: string }>("packages/cli/package.json").version,
}
