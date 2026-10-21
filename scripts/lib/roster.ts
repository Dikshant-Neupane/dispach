import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * The benchmark roster (`evals/models.json`): one list of models every eval sweeps, each hosted model
 * pinned to a single OpenRouter provider. Default routing load-balances across providers and
 * quantisations, and silently drops a parameter no provider supports, so an unpinned result is a
 * result about whichever endpoint happened to answer.
 */

const ROOT = join(import.meta.dirname, "..", "..")

export type Tier = "frontier" | "cheap" | "open-large" | "open-small" | "local"

export interface RosterModel {
    readonly key: string
    readonly tier: Tier
    /** The id the endpoint is called with: an OpenRouter slug or an Ollama tag. */
    readonly id: string
    readonly baseUrl: string
    /** Env var holding the key; absent for a local endpoint. */
    readonly apiKeyEnv?: string
    /** The one OpenRouter provider this model is served by. Absent for a local endpoint. */
    readonly provider?: string
    readonly openWeight: boolean
    /** Billions of parameters (total), where published. */
    readonly params?: number
}

interface RosterFile {
    readonly selectedAt: string
    readonly openrouter: { readonly baseUrl: string; readonly apiKeyEnv: string }
    readonly ollama: { readonly baseUrl: string }
    readonly models: readonly {
        readonly key: string
        readonly tier: Tier
        readonly id: string
        readonly provider?: string
        readonly host?: "ollama"
        readonly openWeight: boolean
        readonly params?: number
    }[]
}

export function loadRoster(only?: readonly string[]): RosterModel[] {
    const file = JSON.parse(readFileSync(join(ROOT, "evals", "models.json"), "utf8")) as RosterFile
    const models = file.models.map((m): RosterModel => {
        const local = m.host === "ollama"
        return {
            key: m.key,
            tier: m.tier,
            id: m.id,
            baseUrl: local ? file.ollama.baseUrl : file.openrouter.baseUrl,
            openWeight: m.openWeight,
            ...(local ? {} : { apiKeyEnv: file.openrouter.apiKeyEnv }),
            ...(m.provider === undefined ? {} : { provider: m.provider }),
            ...(m.params === undefined ? {} : { params: m.params }),
        }
    })
    if (only === undefined || only.length === 0) return models
    const unknown = only.filter((key) => !models.some((m) => m.key === key))
    if (unknown.length > 0)
        throw new Error(
            `Not in evals/models.json: ${unknown.join(", ")}.\n  hint: the keys are ${models.map((m) => m.key).join(", ")}.`,
        )
    return models.filter((m) => only.includes(m.key))
}

/**
 * A `fetch` that pins every request to the model's provider. Handed to the chat-completions provider
 * as `config.fetch`, so the runtime's own transport is what gets measured, with only the routing added.
 */
export function pinnedFetch(model: RosterModel, base: typeof fetch = fetch): typeof fetch {
    if (model.provider === undefined) return base
    const provider = { only: [model.provider], allow_fallbacks: false, require_parameters: true }
    return ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (typeof init?.body !== "string") return base(input, init)
        const body = JSON.parse(init.body) as Record<string, unknown>
        return base(input, { ...init, body: JSON.stringify({ ...body, provider }) })
    }) as typeof fetch
}

export interface PinCheck {
    readonly key: string
    readonly ok: boolean
    readonly detail: string
}

/** Confirm each pinned provider still serves the model with tool calling, today. */
export async function checkPins(models: readonly RosterModel[]): Promise<PinCheck[]> {
    const checks: PinCheck[] = []
    for (const model of models) {
        if (model.provider === undefined) {
            checks.push({ key: model.key, ok: true, detail: "local, not pinned" })
            continue
        }
        const res = await fetch(`${model.baseUrl}/models/${model.id}/endpoints`)
        const json = (await res.json()) as {
            data?: {
                endpoints?: {
                    tag?: string
                    provider_name: string
                    supported_parameters?: string[]
                    quantization?: string
                }[]
            }
        }
        const endpoint = json.data?.endpoints?.find(
            (e) => (e.tag ?? e.provider_name) === model.provider,
        )
        if (endpoint === undefined) {
            checks.push({
                key: model.key,
                ok: false,
                detail: `provider ${model.provider} no longer serves ${model.id}`,
            })
            continue
        }
        const tools = endpoint.supported_parameters?.includes("tools") === true
        checks.push({
            key: model.key,
            ok: tools,
            detail: `${model.provider} q=${endpoint.quantization ?? "unknown"}${tools ? "" : ", NO tool calling"}`,
        })
    }
    return checks
}
