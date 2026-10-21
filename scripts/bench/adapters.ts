/**
 * One adapter per harness in the head-to-head. Each sets the harness up the way its own setup
 * would — for this runtime, `init --yes` and then the person's own `config set` — points it at the
 * proxy and the tool server, and answers one turn as a headless child process.
 */
import { join } from "node:path"
import { BRAND } from "../../packages/core/src/brand.ts"
import type { Harness, HarnessContext } from "./run.ts"

const ROOT = join(import.meta.dirname, "..", "..")
const BIN = join(ROOT, "packages", "cli", "dist", "index.js")
const TURN_TIMEOUT_MS = 300_000
const BENCH_TOOLS = [
    "kv_get",
    "kv_set",
    "read_file",
    "write_file",
    "calculator",
    "lookup_order",
    "now",
    "send_message",
]
const WRITES = ["kv_set", "write_file", "send_message"]

async function cli(
    argv: readonly string[],
    env: Record<string, string>,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    const child = Bun.spawn(["node", BIN, ...argv], {
        env: { ...process.env, ...env },
        stdout: "pipe",
        stderr: "pipe",
        timeout: TURN_TIMEOUT_MS,
    })
    const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    return { ok: code === 0, stdout, stderr }
}

interface Variant {
    readonly dialect: "nlt" | "native"
    /** Authorise the three bench writes past the write gate, as the generated comment says to. */
    readonly allowWrites: boolean
}

function runtimeHarness(name: string, variant: Variant): Harness {
    let manifest = ""
    let env: Record<string, string> = {}
    let store = ""
    return {
        name,
        async prepare(context: HarnessContext) {
            env = {
                [`${BRAND.envPrefix}HOME`]: join(context.dir, "home"),
                [`${BRAND.envPrefix}NO_BOOTSTRAP`]: "1",
                BENCH_KEY: "dummy",
            }
            const agent = join(context.dir, "agent")
            manifest = join(agent, "agent.yaml")
            store = join(context.dir, "store.db")
            const steps: string[][] = [
                [
                    "init",
                    "--yes",
                    "--plain",
                    "--name",
                    "bench",
                    "--user",
                    "bench",
                    "--preset",
                    "custom",
                    "--model",
                    context.model.id,
                    "--base-url",
                    context.modelBaseUrl,
                    "--api-key-env",
                    "BENCH_KEY",
                    "--system",
                    "none",
                    "--web",
                    "none",
                    "--server",
                    "none",
                    "--skills",
                    "none",
                    "--dir",
                    agent,
                ],
                set(
                    "tools.providers",
                    JSON.stringify({
                        system: {},
                        web: {},
                        composio: {},
                        mcp: { servers: { bench: { url: context.mcpUrl } } },
                    }),
                ),
                set(
                    "tools.pinned",
                    JSON.stringify([
                        "config_read",
                        "config_set",
                        ...BENCH_TOOLS.map((t) => `bench__${t}`),
                    ]),
                ),
                ...(variant.allowWrites
                    ? [
                          set(
                              "tools.policy.allow",
                              JSON.stringify([
                                  "memory_write",
                                  "config_set",
                                  ...WRITES.map((t) => `bench__${t}`),
                              ]),
                          ),
                      ]
                    : []),
                ...(variant.dialect === "native" ? [set("tools.dialect", "native")] : []),
                ["tools", manifest, "--warm", "--plain"],
            ]
            for (const argv of steps) {
                const result = await cli(argv, env)
                if (!result.ok)
                    throw new Error(
                        `${name} setup failed at \`${argv.slice(0, 3).join(" ")}\`:\n${result.stderr || result.stdout}\n  hint: run the same command by hand with ${BRAND.envPrefix}HOME=${env[`${BRAND.envPrefix}HOME`]}.`,
                    )
            }

            function set(path: string, value: string): string[] {
                return ["config", "set", manifest, path, value, "--plain", "--yes"]
            }
        },
        async turn(text, session) {
            const result = await cli(
                [
                    "run",
                    manifest,
                    "--input",
                    text,
                    "--session",
                    `local:${session}`,
                    "--store",
                    store,
                    "--plain",
                    "--quiet",
                    "--no-reasoning",
                ],
                env,
            )
            // `--quiet` keeps the reply's own heading; it is chrome, not the answer.
            const reply = result.stdout.replace(/^\s*· reply ·\s*/, "").trim()
            return { reply, ok: result.ok, detail: result.stderr.trim() || result.stdout.trim() }
        },
    }
}

export const HARNESSES: Readonly<Record<string, Harness>> = {
    [`${BRAND.slug}-nlt`]: runtimeHarness(`${BRAND.slug}-nlt`, {
        dialect: "nlt",
        allowWrites: true,
    }),
    [`${BRAND.slug}-native`]: runtimeHarness(`${BRAND.slug}-native`, {
        dialect: "native",
        allowWrites: true,
    }),
    [`${BRAND.slug}-nlt-strict`]: runtimeHarness(`${BRAND.slug}-nlt-strict`, {
        dialect: "nlt",
        allowWrites: false,
    }),
}
