"use client"

import { useEffect, useState } from "react"
import type { Line } from "@/lib/replay"

const TYPE_MS = 14
const PAUSE_MS: Record<Line["kind"], number> = { cmd: 500, out: 260, note: 900 }

/**
 * Plays a captured transcript: commands are typed, responses appear. With reduced motion the
 * whole transcript is shown at once, since the content is the point and the typing is not.
 */
export function Replay({ lines, caption }: { lines: Line[]; caption: string }) {
    const [shown, setShown] = useState(0)
    const [typed, setTyped] = useState(0)
    const [run, setRun] = useState(0)

    // biome-ignore lint/correctness/useExhaustiveDependencies: `run` is the replay button's trigger; the body never reads it, and dropping it makes the button do nothing.
    useEffect(() => {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            setShown(lines.length)
            return
        }
        setShown(0)
        setTyped(0)
        let cancelled = false
        const timers: ReturnType<typeof setTimeout>[] = []
        const wait = (ms: number) =>
            new Promise<void>((resolve) => timers.push(setTimeout(resolve, ms)))
        ;(async () => {
            for (let i = 0; i < lines.length && !cancelled; i++) {
                const line = lines[i]
                if (line === undefined) break
                if (line.kind === "cmd") {
                    setShown(i)
                    for (let c = 1; c <= line.text.length && !cancelled; c++) {
                        setTyped(c)
                        await wait(TYPE_MS)
                    }
                }
                setShown(i + 1)
                setTyped(0)
                await wait(PAUSE_MS[line.kind])
            }
        })()
        return () => {
            cancelled = true
            for (const t of timers) clearTimeout(t)
        }
    }, [lines, run])

    const typing = lines[shown]?.kind === "cmd" && typed > 0 ? lines[shown] : undefined
    const done = shown >= lines.length

    return (
        <figure
            aria-label="Recorded terminal session"
            className="overflow-hidden rounded-xl border border-fd-border bg-neutral-950 text-left shadow-2xl"
        >
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
                <span className="size-2.5 rounded-full bg-white/15" />
                <span className="size-2.5 rounded-full bg-white/15" />
                <span className="size-2.5 rounded-full bg-white/15" />
                <span className="ml-2 font-mono text-xs text-neutral-500">curl, two clients</span>
            </div>
            <pre className="h-[23rem] overflow-y-auto whitespace-pre-wrap break-all px-4 py-3 font-mono text-[12.5px] leading-relaxed text-neutral-300">
                {lines.slice(0, shown).map((line, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: a fixed transcript where one line repeats verbatim; position is its identity.
                    <Row key={`${run}-${i}`} line={line} />
                ))}
                {typing && <Row line={{ ...typing, text: typing.text.slice(0, typed) }} cursor />}
                {done && <span className="text-emerald-400">$ </span>}
                {done && <span className="animate-pulse text-neutral-500">▍</span>}
            </pre>
            <figcaption className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-2 font-mono text-[11px] text-neutral-500">
                <span>{caption}</span>
                <button
                    type="button"
                    onClick={() => setRun((n) => n + 1)}
                    className="shrink-0 text-neutral-400 hover:text-white"
                >
                    replay ↻
                </button>
            </figcaption>
        </figure>
    )
}

function Row({ line, cursor = false }: { line: Line; cursor?: boolean }) {
    if (line.kind === "cmd")
        return (
            <div>
                <span className="text-emerald-400">$ </span>
                <span className="text-neutral-100">{line.text}</span>
                {cursor && <span className="text-neutral-500">▍</span>}
            </div>
        )
    if (line.kind === "note") return <div className="text-amber-300/80"># {line.text}</div>
    return <div className="text-neutral-400">{line.text}</div>
}
