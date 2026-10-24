#!/usr/bin/env bun
/**
 * The benchmark roster, checked on the day it is used.
 *
 *   bun scripts/roster.ts --check            every pinned provider still serves its model with tools (free)
 *   bun --env-file=.env scripts/roster.ts --ping [keys…]
 *                                            one tiny request per model, reporting who actually answered
 *                                            and what it cost: proof the pin holds, for a fraction of a cent
 */
import { checkPins, loadRoster, pinnedFetch } from "./lib/roster.ts"

const args = process.argv.slice(2)
const keys = args.filter((a) => !a.startsWith("--"))
const roster = loadRoster(keys)

if (args.includes("--check")) {
    const checks = await checkPins(roster)
    for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.key.padEnd(20)} ${c.detail}`)
    if (checks.some((c) => !c.ok)) {
        console.error(
            "  hint: re-pin the failing model in evals/models.json (vendor endpoint first, then highest precision).",
        )
        process.exit(1)
    }
} else if (args.includes("--ping")) {
    let failed = false
    for (const model of roster) {
        const key = model.apiKeyEnv === undefined ? undefined : process.env[model.apiKeyEnv]
        if (model.apiKeyEnv !== undefined && (key === undefined || key === "")) {
            console.log(`skip ${model.key.padEnd(20)} ${model.apiKeyEnv} is not set`)
            continue
        }
        const started = Date.now()
        try {
            const res = await pinnedFetch(model)(`${model.baseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(key === undefined ? {} : { authorization: `Bearer ${key}` }),
                },
                body: JSON.stringify({
                    model: model.id,
                    messages: [{ role: "user", content: "Reply with the word ok." }],
                    max_tokens: 400,
                }),
            })
            const json = (await res.json()) as {
                provider?: string
                usage?: { cost?: number }
                error?: { message?: string }
                choices?: { message?: { content?: string } }[]
            }
            if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`)
            const reply = (json.choices?.[0]?.message?.content ?? "").trim().slice(0, 20)
            const cost = json.usage?.cost === undefined ? "" : ` $${json.usage.cost.toFixed(5)}`
            console.log(
                `ok   ${model.key.padEnd(20)} served by ${json.provider ?? "local"}${cost} ${Date.now() - started}ms "${reply}"`,
            )
        } catch (error) {
            failed = true
            console.log(`FAIL ${model.key.padEnd(20)} ${(error as Error).message}`)
        }
    }
    if (failed) process.exit(1)
} else {
    for (const m of roster)
        console.log(
            `${m.key.padEnd(20)} ${m.tier.padEnd(11)} ${m.id}${m.provider === undefined ? "" : ` @ ${m.provider}`}`,
        )
}
