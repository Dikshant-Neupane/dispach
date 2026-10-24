import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Metadata } from "next"
import { brand, repoUrl } from "@/lib/shared"

interface Claim {
    section: string
    claim: string
    evidence: string
    scope: string
    limitation: string
    status: string
    files: string[]
}
interface Eval {
    name: string
    title: string
    results: string[]
    measuredAt?: string
}

/** Written by `bun run evals:index` and held current by `docs:check` in CI. */
const feed = JSON.parse(readFileSync(join(process.cwd(), "..", "evals", "index.json"), "utf8")) as {
    claims: Claim[]
    evals: Eval[]
}

export const metadata: Metadata = {
    title: `Evals · ${brand.name}`,
    description: `Every number ${brand.name} states in public, with the file it comes from.`,
}

const STATUS_STYLE: Record<string, string> = {
    verified: "bg-green-500/15 text-green-700 dark:text-green-400",
    cite: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    "needs-run": "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    remove: "bg-fd-muted text-fd-muted-foreground line-through",
}

function Status({ status }: { status: string }) {
    const key = Object.keys(STATUS_STYLE).find((k) => status.startsWith(k)) ?? "remove"
    return (
        <span
            className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[key]}`}
        >
            {status}
        </span>
    )
}

/** The register writes evidence as Markdown; links and code spans are the only syntax it uses. */
function Evidence({ text }: { text: string }) {
    const parts = text.split(/(`[^`]+`|\[[^\]]+\]\([^)]+\))/g)
    let offset = 0
    return (
        <>
            {parts.map((part) => {
                // A part's offset in the text is its identity: unique, and stable across renders.
                const key = offset
                offset += part.length
                const code = part.match(/^`([^`]+)`$/)
                if (code?.[1]) {
                    const file = code[1].replace(/:\d+$/, "")
                    return /\.(json|ts|yml|md)$/.test(file) ? (
                        <a
                            key={key}
                            href={`${repoUrl}/blob/main/${file}`}
                            className="font-mono text-xs underline"
                        >
                            {code[1]}
                        </a>
                    ) : (
                        <code key={key}>{code[1]}</code>
                    )
                }
                const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
                if (link)
                    return (
                        <a key={key} href={link[2]} className="underline">
                            {link[1]}
                        </a>
                    )
                return <span key={key}>{part.replace(/\*\*/g, "")}</span>
            })}
        </>
    )
}

export default function EvalsPage() {
    const sections = [...new Set(feed.claims.map((c) => c.section))]
    const count = (s: string) => feed.claims.filter((c) => c.status.startsWith(s)).length
    return (
        <main className="mx-auto w-full max-w-5xl px-4 py-12">
            <h1 className="text-3xl font-bold">Evaluations</h1>
            <p className="mt-3 text-fd-muted-foreground">
                Every number {brand.name} states in public has a row here naming the committed file
                it comes from. Negative results are listed beside the positive ones, and a claim
                without evidence is marked as such rather than left out. CI fails when a verified
                claim's file goes missing.
            </p>
            <p className="mt-3 text-sm">
                {feed.claims.length} claims: {count("verified")} verified, {count("cite")} cited
                from external research, {count("needs-run")} waiting on a run, {count("remove")}{" "}
                withdrawn.
            </p>

            {sections.map((section) => (
                <section key={section} className="mt-10">
                    <h2 className="text-xl font-semibold">{section}</h2>
                    <ul className="mt-4 divide-y divide-fd-border">
                        {feed.claims
                            .filter((c) => c.section === section)
                            .map((c) => (
                                <li key={c.claim} className="py-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <p className="font-medium">
                                            <Evidence text={c.claim} />
                                        </p>
                                        <Status status={c.status} />
                                    </div>
                                    <p className="mt-1 text-sm">
                                        <Evidence text={c.evidence} />
                                    </p>
                                    {c.limitation !== "" && c.limitation !== "—" && (
                                        <p className="mt-1 text-sm text-fd-muted-foreground">
                                            <Evidence text={c.limitation} />
                                        </p>
                                    )}
                                </li>
                            ))}
                    </ul>
                </section>
            ))}

            <section className="mt-12">
                <h2 className="text-xl font-semibold">Eval suites</h2>
                <ul className="mt-4 divide-y divide-fd-border text-sm">
                    {feed.evals.map((e) => (
                        <li
                            key={e.name}
                            className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                        >
                            <a
                                href={`${repoUrl}/tree/main/evals/${e.name}`}
                                className="font-mono underline"
                            >
                                {e.name}
                            </a>
                            <span className="flex-1 text-fd-muted-foreground">{e.title}</span>
                            <span className="text-xs text-fd-muted-foreground">
                                {e.results.length === 0
                                    ? "no committed results"
                                    : `measured ${e.measuredAt?.slice(0, 10) ?? "date not recorded"}`}
                            </span>
                        </li>
                    ))}
                </ul>
            </section>
        </main>
    )
}
