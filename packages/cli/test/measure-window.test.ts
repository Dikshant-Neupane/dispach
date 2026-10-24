/**
 * The endpoint's own window, asked once by `init` (decision 14.124), and the generated dialect (14.125).
 *
 * The far-end guards read the generated `agent.yaml`, because a value between a flag and the file passes
 * through object literals that are not excess-property-checked: the shape this repo has lost six fields to.
 */

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { initCommand } from "#init"
import { EXIT_OK } from "#lib/const"
import { measuredWindow } from "#lib/measure-window"

const json = (body: unknown) => Response.json(body)

describe("measuredWindow", () => {
    test("OpenRouter's endpoint list gives the smallest window, since routing can land on any", async () => {
        const fetch = (async (url: unknown) =>
            String(url).endsWith("/models/qwen/qwen3.5-9b/endpoints")
                ? json({
                      data: {
                          endpoints: [{ context_length: 262_144 }, { context_length: 131_072 }],
                      },
                  })
                : new Response("", { status: 404 })) as typeof globalThis.fetch
        expect(
            await measuredWindow("https://openrouter.ai/api/v1", "qwen/qwen3.5-9b", { fetch }),
        ).toEqual({
            tokens: 131_072,
            source: "the smallest of 2 published endpoints at https://openrouter.ai/api/v1",
        })
    })

    test("a vLLM-style listing gives max_model_len", async () => {
        const fetch = (async (url: unknown) =>
            String(url).endsWith("/v1/models")
                ? json({ data: [{ id: "my-model", max_model_len: 65_536 }] })
                : new Response("", { status: 404 })) as typeof globalThis.fetch
        expect((await measuredWindow("http://gpu:8000/v1", "my-model", { fetch }))?.tokens).toBe(
            65_536,
        )
    })

    test("an endpoint that says nothing, or cannot be reached, is unknown", async () => {
        const silent = (async (_url: unknown, _init?: RequestInit): Promise<Response> =>
            json({ data: [{ id: "qwen3.5:9b" }] })) as typeof globalThis.fetch
        expect(
            await measuredWindow("http://localhost:11434/v1", "qwen3.5:9b", { fetch: silent }),
        ).toBeUndefined()
        const down = (async (_url: unknown, _init?: RequestInit): Promise<Response> => {
            throw new Error("ECONNREFUSED")
        }) as typeof globalThis.fetch
        expect(await measuredWindow("http://localhost:1/v1", "x", { fetch: down })).toBeUndefined()
    })
})

describe("init and the endpoint", () => {
    const real = globalThis.fetch
    afterEach(() => {
        globalThis.fetch = real
    })
    const FLAGS = {
        user: "Moeen",
        name: "Milo",
        purpose: "keeps my week on track",
        yes: true,
    } as const
    const dir = () => join(mkdtempSync(join(tmpdir(), "measure-window-")), "agent")

    test("init --yes reaches no network, and asked to, writes the window it was told", async () => {
        const urls: string[] = []
        globalThis.fetch = (async (url: unknown) => {
            urls.push(String(url))
            return json({ data: { endpoints: [{ context_length: 262_144 }] } })
        }) as typeof globalThis.fetch
        const flags = {
            ...FLAGS,
            model: "qwen/qwen3.5-9b",
            baseUrl: "https://openrouter.ai/api/v1",
        }

        const quiet = dir()
        expect(await initCommand({ ...flags, dir: quiet })).toBe(EXIT_OK)
        expect(urls).toEqual([])
        expect(readFileSync(join(quiet, "agent.yaml"), "utf8")).not.toMatch(/^ {2}window:/m)

        const measured = dir()
        expect(await initCommand({ ...flags, dir: measured, measureWindow: true })).toBe(EXIT_OK)
        expect(urls[0]).toBe("https://openrouter.ai/api/v1/models/qwen/qwen3.5-9b/endpoints")
        expect(readFileSync(join(measured, "agent.yaml"), "utf8")).toMatch(/^ {2}window: 262144$/m)
    })

    test("the dialect is native for a model the registry knows to call tools, nlt otherwise", async () => {
        const known = dir()
        expect(await initCommand({ ...FLAGS, dir: known, preset: "deepseek" })).toBe(EXIT_OK)
        expect(readFileSync(join(known, "agent.yaml"), "utf8")).toMatch(/^ {2}dialect: native$/m)

        const unknown = dir()
        const flags = {
            ...FLAGS,
            dir: unknown,
            model: "nobody-knows-this-model",
            baseUrl: "http://localhost:9/v1",
        }
        await initCommand(flags)
        expect(readFileSync(join(unknown, "agent.yaml"), "utf8")).toMatch(/^ {2}dialect: nlt$/m)
    })
})
