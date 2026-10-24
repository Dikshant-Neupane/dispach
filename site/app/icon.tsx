import { ImageResponse } from "next/og"
import { initial } from "@/lib/wordmark"

export const size = { width: 64, height: 64 }
export const contentType = "image/png"

/** The wordmark's first letter in the accent, on the dark theme's background, one square per pixel. */
export default function Icon() {
    const cell = Math.floor(48 / Math.max(initial.width, initial.height))
    const left = (size.width - initial.width * cell) / 2
    const top = (size.height - initial.height * cell) / 2
    return new ImageResponse(
        <div
            style={{
                display: "flex",
                width: "100%",
                height: "100%",
                background: "#121212",
                borderRadius: 12,
                position: "relative",
            }}
        >
            {initial.cells.map(({ x, y }) => (
                <div
                    key={`${x}-${y}`}
                    style={{
                        position: "absolute",
                        left: left + x * cell,
                        top: top + y * cell,
                        width: cell,
                        height: cell,
                        background: "#d75fd7",
                    }}
                />
            ))}
        </div>,
        size,
    )
}
