import { wordmark } from "../../packages/cli/src/lib/wordmark"
import { brand } from "./shared"

/**
 * The TUI's own wordmark, drawn from the brand name by the same renderer: never written down.
 * The `block` tier is one cell per pixel; 60 columns is wide enough for it and too narrow for `wide`.
 */
function grid(text: string, columns: number) {
    const mark = wordmark(text, { columns, rows: 5 })
    return {
        width: mark.width,
        height: mark.lines.length,
        /** Each `█` cell as a unit square, so a browser draws pixels rather than a font's idea of a block glyph. */
        cells: mark.lines.flatMap((line, y) =>
            [...line].flatMap((cell, x) => (cell === "█" ? [{ x, y }] : [])),
        ),
    }
}

export const pixels = grid(brand.name, 60)

/** The name's first letter alone, for the favicon. Nine columns, so a 5-pixel glyph is drawn one cell per pixel rather than doubled. */
export const initial = grid(brand.name.slice(0, 1), 9)
