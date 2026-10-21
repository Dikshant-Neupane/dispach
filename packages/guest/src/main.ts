#!/usr/bin/env node
import { BRAND } from "./brand.ts"
import { Guests } from "./guests.ts"
import { createBroker } from "./server.ts"

const env = (name: string): string | undefined => {
    const value = process.env[`${BRAND.envPrefix}${name}`]
    return value === undefined || value.trim() === "" ? undefined : value
}

function required(name: string, hint: string): string {
    const value = env(name)
    if (value !== undefined) return value
    process.stderr.write(`${BRAND.envPrefix}${name} is not set.\n  hint: ${hint}\n`)
    process.exit(1)
}

function count(name: string, fallback: number): number {
    const value = env(name)
    if (value === undefined) return fallback
    if (/^[1-9][0-9]*$/.test(value)) return Number(value)
    process.stderr.write(
        `${BRAND.envPrefix}${name}="${value}" is not a whole number of tokens.\n  hint: unset it for ${fallback.toLocaleString("en")}.\n`,
    )
    process.exit(1)
}

const guests = new Guests({
    perGuest: count("TOKENS_PER_GUEST", 150_000),
    daily: count("TOKENS_PER_DAY", 10_000_000),
})
const broker = createBroker({
    guests,
    upstream: {
        baseUrl: required(
            "MODEL_BASE_URL",
            "the OpenAI-compatible endpoint guests' agents are served from, e.g. https://api.deepseek.com/v1.",
        ),
        model: required(
            "MODEL_ID",
            "the one model every guest call is sent to, e.g. deepseek-v4-flash.",
        ),
        apiKey: required(
            "MODEL_API_KEY",
            "the provider key. It stays in this process; no silo ever receives it.",
        ),
    },
})
const host = env("HOST") ?? "127.0.0.1"
const port = Number(env("PORT") ?? 7700)
broker.listen(port, host, () => process.stdout.write(`guest broker on http://${host}:${port}\n`))
