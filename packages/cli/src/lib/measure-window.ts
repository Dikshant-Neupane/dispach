/**
 * The context window an endpoint publishes for a model, asked once by `init` (decision 14.124).
 *
 * The capability registry knows windows by model id, and a window is a fact about the endpoint: qwen3.5 is
 * 32,768 on a local Ollama and 262,144 on DeepInfra, and the registry's one row cut a hosted qwen's files to
 * 8,000 characters. So `init` asks the endpoint and writes what it says into `context.window`, where the
 * person can see and change it. This runs at setup, never at boot: a runtime that needed the network to
 * learn its own window would be the boot-time network call this project exists to avoid.
 *
 * Two shapes are asked, each with a short timeout, and anything else is "unknown", leaving the registry
 * in charge: OpenRouter's `/models/{id}/endpoints`, taking the smallest window, since unpinned routing can
 * land on any of them, and an OpenAI-style `/models` listing that carries `context_length` (OpenRouter,
 * several hosts) or `max_model_len` (vLLM). Ollama's `/v1/models` carries neither, so a local model keeps
 * its registry row.
 */

const TIMEOUT_MS = 3000

export interface MeasuredWindow {
    readonly tokens: number
    /** Where the number came from, written beside it in the manifest. */
    readonly source: string
}

type Json = Record<string, unknown>

const positive = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined

export async function measuredWindow(
    baseUrl: string,
    model: string,
    options: { readonly apiKey?: string; readonly fetch?: typeof fetch } = {},
): Promise<MeasuredWindow | undefined> {
    const get = options.fetch ?? fetch
    const base = baseUrl.replace(/\/+$/, "")
    const headers: Record<string, string> =
        options.apiKey === undefined ? {} : { authorization: `Bearer ${options.apiKey}` }
    const read = async (url: string): Promise<Json | undefined> => {
        try {
            const response = await get(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
            if (!response.ok) return undefined
            const body: unknown = await response.json()
            return body !== null && typeof body === "object" ? (body as Json) : undefined
        } catch {
            return undefined
        }
    }

    const endpoints = await read(`${base}/models/${model}/endpoints`)
    const listed = ((endpoints?.data as Json | undefined)?.endpoints ?? []) as Json[]
    const windows = listed
        .map((entry) => positive(entry.context_length))
        .filter((n) => n !== undefined)
    if (windows.length > 0)
        return {
            tokens: Math.min(...windows),
            source: `the smallest of ${windows.length} published endpoint${windows.length === 1 ? "" : "s"} at ${base}`,
        }

    const models = await read(`${base}/models`)
    const entry = ((models?.data ?? []) as Json[]).find((m) => m.id === model)
    const tokens = positive(entry?.context_length) ?? positive(entry?.max_model_len)
    return tokens === undefined ? undefined : { tokens, source: `${base}/models` }
}
