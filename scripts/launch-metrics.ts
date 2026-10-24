#!/usr/bin/env bun
/**
 * The launch's weekly counts, by stage.
 *
 *   bun scripts/launch-metrics.ts [--image-pulls N] [--site-visitors N]
 *
 * Prints the week and appends one row to `.metrics/launch.csv` (gitignored). npm and GitHub are read
 * here. Two sources have no API, so their numbers are passed in by hand: GHCR shows pulls only on the
 * package page, and Vercel Web Analytics only on its dashboard. GitHub keeps traffic for 14 days, so a
 * week not collected is a week lost.
 *
 * Activation, retention and adoption are not here. The runtime sends no telemetry, so those come from
 * the cohort itself, not from a counter.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "..")
const CSV = join(ROOT, ".metrics", "launch.csv")
const COLUMNS = [
    "week_end",
    "npm_downloads",
    "repo_views",
    "repo_visitors",
    "clones",
    "cloners",
    "stars",
    "forks",
    "image_pulls",
    "site_visitors",
] as const

function fail(message: string, hint: string): never {
    process.stderr.write(`launch-metrics: ${message}\n  hint: ${hint}\n`)
    process.exit(1)
}

const pkg = JSON.parse(readFileSync(join(ROOT, "packages/cli/package.json"), "utf8")) as {
    name: string
    repository: { url: string }
}
const repo = /github\.com\/([^/]+\/[^/.]+)/.exec(pkg.repository.url)?.[1]
if (repo === undefined)
    fail("no GitHub repository in packages/cli/package.json", "Set repository.url.")

function flag(name: string): number | undefined {
    const at = process.argv.indexOf(`--${name}`)
    if (at === -1) return undefined
    const value = Number(process.argv[at + 1])
    if (!Number.isInteger(value) || value < 0)
        fail(`--${name} needs a whole number`, `For example --${name} 12.`)
    return value
}

function gh<T>(path: string): T {
    const run = Bun.spawnSync(["gh", "api", path])
    if (run.exitCode !== 0)
        fail(
            `gh api ${path} failed: ${run.stderr.toString().trim()}`,
            "Traffic needs push access to the repository; run `gh auth status` to check the login.",
        )
    return JSON.parse(run.stdout.toString()) as T
}

interface Traffic {
    readonly count: number
    readonly uniques: number
    readonly views?: readonly { timestamp: string; count: number; uniques: number }[]
    readonly clones?: readonly { timestamp: string; count: number; uniques: number }[]
}

/** The last seven days of GitHub's fourteen. Uniques are summed per day, so a returning visitor counts once a day. */
function lastWeek(days: Traffic["views"]): { count: number; uniques: number } {
    const recent = (days ?? []).slice(-7)
    return {
        count: recent.reduce((sum, day) => sum + day.count, 0),
        uniques: recent.reduce((sum, day) => sum + day.uniques, 0),
    }
}

const npmResponse = await fetch(`https://api.npmjs.org/downloads/point/last-week/${pkg.name}`)
if (!npmResponse.ok)
    fail(
        `npm downloads answered ${npmResponse.status}`,
        "Retry later; the npm downloads API is public.",
    )
const npm = (await npmResponse.json()) as { downloads: number; end: string }

const meta = gh<{ stargazers_count: number; forks_count: number }>(`repos/${repo}`)
const views = lastWeek(gh<Traffic>(`repos/${repo}/traffic/views`).views)
const clones = lastWeek(gh<Traffic>(`repos/${repo}/traffic/clones`).clones)
const referrers = gh<readonly { referrer: string; count: number; uniques: number }[]>(
    `repos/${repo}/traffic/popular/referrers`,
)
const imagePulls = flag("image-pulls")
const siteVisitors = flag("site-visitors")

const row = {
    week_end: npm.end,
    npm_downloads: npm.downloads,
    repo_views: views.count,
    repo_visitors: views.uniques,
    clones: clones.count,
    cloners: clones.uniques,
    stars: meta.stargazers_count,
    forks: meta.forks_count,
    image_pulls: imagePulls ?? "",
    site_visitors: siteVisitors ?? "",
}

const unknown = "not given"
process.stdout.write(`Week ending ${npm.end}

Discovery
  repository   ${views.count} views, ${views.uniques} visitor-days · ${meta.stargazers_count} stars · ${meta.forks_count} forks
  docs site    ${siteVisitors ?? `${unknown}: read the Vercel dashboard (Analytics), pass --site-visitors`}
  referrers    ${
      referrers
          .slice(0, 5)
          .map((r) => `${r.referrer} ${r.uniques}`)
          .join(", ") || "none"
}

Trial
  npm          ${npm.downloads} downloads
  clones       ${clones.count} clones by ${clones.uniques} cloner-days
  image        ${imagePulls ?? `${unknown}: read https://github.com/${repo}/pkgs/container/${pkg.name}, pass --image-pulls`}

Activation, retention, adoption: from the cohort. The runtime sends no telemetry.
`)

mkdirSync(join(ROOT, ".metrics"), { recursive: true })
if (!existsSync(CSV)) appendFileSync(CSV, `${COLUMNS.join(",")}\n`)
appendFileSync(CSV, `${COLUMNS.map((column) => row[column]).join(",")}\n`)
process.stdout.write(`\nappended to ${CSV.slice(ROOT.length + 1)}\n`)
