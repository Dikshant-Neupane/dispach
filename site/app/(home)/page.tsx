import Link from "next/link"
import { Replay } from "@/components/replay"
import { evidence } from "@/lib/evidence"
import { capturedAt, capturedModel, replay } from "@/lib/replay"
import { brand, repoUrl } from "@/lib/shared"
import { pixels } from "@/lib/wordmark"

const QUICKSTART = "/docs/runtime/quickstart/run-with-docker"

/** The job, before the proofs: what a product team no longer has to build around a model. */
const BUILT_IN = [
    ["Sessions", "Every conversation persisted and resumable, keyed however your product keys it."],
    [
        "Memory",
        "Notes and past conversations recalled across sessions, ranked lexically, no vector store.",
    ],
    [
        "Tools under a policy",
        "Shell, files, web, MCP and Composio. A policy decides what runs; a floor no rule can lift.",
    ],
    [
        "Schedules",
        "Cron, interval and one-shot, DST-correct, delivered through the same outbox as replies.",
    ],
    ["Channels", "Telegram and WhatsApp. Slack, Teams and A2A ship experimental."],
    [
        "Approvals and keys",
        "A human gate on writes over the wire, and keys scoped to one agent or one tenant.",
    ],
] as const

const qwen = evidence.dialect.find((d) => d.model.startsWith("qwen"))

const PROOFS = [
    {
        figure: "202",
        title: "Turns outlive the client",
        body: "A turn is detached from the request that started it. Drop the connection, reattach from any client, and the stream replays from the start.",
        caveat: "The recording above is that, unedited apart from shortened request bodies.",
        href: "/docs/runtime/concepts/turn-lifecycle",
        link: "Turn lifecycle",
    },
    {
        figure: `${evidence.bootMs} ms`,
        title: "Process start to ready",
        body: "No network I/O before readiness, by rule. Channels and remote catalogues connect afterwards and report status as events.",
        caveat: `Median of 7 boots, ${evidence.bootMachine}. Boot, not response latency. CI fails above 1,200 ms.`,
        href: "/evals",
        link: "Evidence",
    },
    {
        figure: qwen ? `${qwen.nlt}%` : "NLT",
        title: "Tool calls small models get right",
        body: `The default tool dialect beat native function calling on all ${evidence.dialect.length} models we ran${qwen ? `, a 9B open-weight model included (${qwen.nlt}% vs ${qwen.native}%)` : ""}.`,
        caveat: "37 fixtures, routing and arguments only, no tool executed. On the 9B model the margin is one fixture.",
        href: "/evals",
        link: "Evidence",
    },
    {
        figure: `${evidence.idleMiB} MiB`,
        title: `${evidence.agents} agents, one process`,
        body: "One runtime hosts many agents, and scoped keys fence each off. Adopt and remove agents live, with no restart.",
        caveat: "Idle resident memory, linux/arm64 image, one machine.",
        href: "/evals",
        link: "Evidence",
    },
]

export default function HomePage() {
    return (
        <main className="flex flex-1 flex-col">
            <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-16 pb-20 lg:grid-cols-[1fr_1.1fr] lg:pt-24">
                <div>
                    <svg
                        role="img"
                        aria-label={brand.name}
                        viewBox={`0 0 ${pixels.width} ${pixels.height}`}
                        className="mb-8 h-10 w-auto text-term-accent sm:h-12"
                        shapeRendering="crispEdges"
                    >
                        {pixels.cells.map(({ x, y }) => (
                            <rect
                                key={`${x}:${y}`}
                                x={x}
                                y={y}
                                width={1}
                                height={1}
                                fill="currentColor"
                            />
                        ))}
                    </svg>
                    <p className="font-mono text-xs text-fd-muted-foreground">
                        v{evidence.version} · Apache-2.0 · self-hosted
                    </p>
                    <h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                        The agent backend your product calls over HTTP.
                    </h1>
                    <p className="mt-5 max-w-xl text-lg text-fd-muted-foreground">
                        Your backend sends a message and {brand.name} runs the agent: memory, tools,
                        schedules, channels and approvals, on any OpenAI-compatible model, on
                        infrastructure you control.
                    </p>
                    <div className="mt-8 flex flex-wrap gap-3">
                        <Link
                            href={QUICKSTART}
                            className="rounded-lg bg-term-accent px-4 py-2.5 text-sm font-medium text-neutral-950 hover:brightness-110"
                        >
                            Run it in five minutes
                        </Link>
                        <a
                            href={repoUrl}
                            className="rounded-lg border border-fd-border px-4 py-2.5 text-sm font-medium hover:bg-fd-accent"
                        >
                            GitHub
                        </a>
                    </div>
                    <p className="mt-6 font-mono text-xs text-fd-muted-foreground">
                        <span className="text-term-accent">›</span> npm install --global{" "}
                        {brand.slug}
                    </p>
                </div>
                <Replay
                    lines={replay}
                    caption={`recorded run · ${capturedAt} · ${capturedModel} · live shell coming`}
                />
            </section>

            <section className="border-y border-fd-border bg-fd-card/40">
                <div className="mx-auto w-full max-w-6xl px-4 py-16">
                    <h2 className="font-mono text-sm text-term-accent">what you don't build</h2>
                    <dl className="mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
                        {BUILT_IN.map(([term, detail]) => (
                            <div key={term}>
                                <dt className="font-medium">{term}</dt>
                                <dd className="mt-1 text-sm text-fd-muted-foreground">{detail}</dd>
                            </div>
                        ))}
                    </dl>
                </div>
            </section>

            <section className="mx-auto w-full max-w-6xl px-4 py-16">
                <h2 className="font-mono text-sm text-term-accent">proof, with the caveats</h2>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    {PROOFS.map((p) => (
                        <article
                            key={p.title}
                            className="flex flex-col rounded-2xl border border-fd-border p-6 hover:border-term-accent/60"
                        >
                            <p className="font-mono text-3xl font-semibold">{p.figure}</p>
                            <h3 className="mt-2 font-medium">{p.title}</h3>
                            <p className="mt-2 text-sm text-fd-muted-foreground">{p.body}</p>
                            <p className="mt-3 text-xs text-fd-muted-foreground/80">{p.caveat}</p>
                            <Link
                                href={p.href}
                                className="mt-auto pt-4 font-mono text-xs text-term-accent hover:underline"
                            >
                                {p.link} →
                            </Link>
                        </article>
                    ))}
                </div>
                <p className="mt-6 text-sm text-fd-muted-foreground">
                    Every number on this site has a row in the{" "}
                    <Link href="/evals" className="underline">
                        claim register
                    </Link>
                    , negative results included.
                </p>
            </section>

            <section className="mx-auto w-full max-w-6xl px-4 pb-16">
                <div className="rounded-xl border border-dashed border-term-warning/50 p-6">
                    <p className="font-mono text-xs text-term-warning">
                        experimental · where it's going
                    </p>
                    <p className="mt-2 max-w-3xl">
                        The multiplayer agent runtime: an isolated runtime for every user and team
                        in your product, with agents that share rooms and memory with the people
                        they work for, and stand in for them, openly, when they are away.
                    </p>
                    <p className="mt-2 text-sm text-fd-muted-foreground">
                        In {evidence.version} it is on the HTTP API only, with no screens yet, and
                        it may change within 0.2.x. Everything above is stable.
                    </p>
                </div>
            </section>

            <footer className="border-t border-fd-border">
                <div className="mx-auto flex w-full max-w-6xl flex-wrap justify-between gap-4 px-4 py-8 text-xs text-fd-muted-foreground">
                    <p>
                        The runtime is Apache-2.0. The control plane (<code>packages/control</code>)
                        is source-available under FSL-1.1-ALv2.
                    </p>
                    <p className="flex gap-4">
                        <Link href="/docs">Docs</Link>
                        <Link href="/evals">Evals</Link>
                        <a href={repoUrl}>GitHub</a>
                    </p>
                </div>
            </footer>
        </main>
    )
}
