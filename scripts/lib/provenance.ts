/**
 * Where and when a committed eval result was measured.
 *
 * A latency figure without its machine is a number about somebody's afternoon: the same tree
 * measured 53 ms and 58 ms for boot depending on what else was running. Every result a public claim
 * cites (`evals/CLAIMS.md`) carries this block, so the claim can name its conditions.
 */

import { spawnSync } from "node:child_process"
import { cpus, loadavg, platform, release } from "node:os"
import { resolve } from "node:path"

export interface Provenance {
    readonly measuredAt: string
    readonly commit: string
    readonly runtime: string
    readonly machine: {
        readonly cpu: string
        readonly os: string
        readonly loadAverage: readonly number[]
    }
}

export function provenance(): Provenance {
    const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
        cwd: resolve(import.meta.dirname, "..", ".."),
        encoding: "utf8",
    })
    return {
        measuredAt: new Date().toISOString(),
        commit: commit.stdout?.trim() || "unknown",
        runtime: `${process.execPath.split("/").pop()} ${process.versions.bun ?? process.version}`,
        machine: {
            cpu: cpus()[0]?.model ?? "unknown",
            os: `${platform()} ${release()}`,
            loadAverage: loadavg().map((value) => Number(value.toFixed(2))),
        },
    }
}
