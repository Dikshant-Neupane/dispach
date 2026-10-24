import { wordmark } from "../../packages/cli/src/lib/wordmark"
import { brand } from "./shared"

/**
 * The TUI's own wordmark, drawn from the brand name by the same renderer: never written down.
 * The `block` tier is one cell per pixel; 60 columns is wide enough for it and too narrow for `wide`.
 */
const mark = wordmark(brand.name, { columns: 60, rows: 5 })

/** Each `█` cell as a unit square, so a browser draws pixels rather than a font's idea of a block glyph. */
export const pixels = {
    width: mark.width,
    height: mark.lines.length,
    cells: mark.lines.flatMap((line, y) =>
        [...line].flatMap((cell, x) => (cell === "█" ? [{ x, y }] : [])),
    ),
}
