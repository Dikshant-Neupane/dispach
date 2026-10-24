import { describe, expect, test } from "bun:test"
import { build, readme } from "../../../scripts/bench/summary.ts"

describe("bench summary", () => {
    const summary = build()

    test("the README's table is replaced between its markers and nothing else moves", () => {
        const text = "intro\n<!-- benchmark:start -->\nold table\n<!-- benchmark:end -->\noutro\n"
        const out = readme(text, summary)
        expect(out.startsWith("intro\n<!-- benchmark:start -->\n| Model |")).toBe(true)
        expect(out.endsWith("\n<!-- benchmark:end -->\noutro\n")).toBe(true)
        expect(out).not.toContain("old table")
        // Running it twice changes nothing, which is what `--check` relies on.
        expect(readme(out, summary)).toBe(out)
    })

    test("a README without the markers is refused, never appended to", () => {
        expect(() => readme("no markers here\n", summary)).toThrow(/benchmark:start/)
    })

    test("a paused arm is never published as a rate", () => {
        const qwen = summary.models.find((m) => m.key === "qwen3.5-9b")
        expect(qwen?.nlt?.paused).toBe(true)
        expect(qwen?.native?.paused).toBeUndefined()
    })
})
