/**
 * One adapter per harness in the head-to-head. Each sets the harness up the way its own setup
 * would — for this runtime, `init --yes` and then the person's own `config set` — points it at the
 * proxy and the tool server, and answers one turn as a headless child process.
 */
import { join } from "node:path"
import { BRAND } from "../../packages/core/src/brand.ts"
import type { RosterModel } from "../lib/roster.ts"
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
                // A model the capability registry does not know gets an 8k window, which init's own
                // reserveOutput does not fit, so the agent it wrote does not load. Do what the error
                // tells a person to: declare the window — the pinned endpoint's published one.
                if (
                    !result.ok &&
                    argv[0] === "init" &&
                    `${result.stdout}${result.stderr}`.includes("context.reserveOutput")
                ) {
                    const { window, tools } = await published(context.model)
                    console.log(
                        `note: ${name} — the registry does not know ${context.model.id}; init's agent did not load, so its window (${window}) and native tool support (${tools}) were set from ${context.model.provider}'s published endpoint through config set model.main.`,
                    )
                    const role = {
                        id: context.model.id,
                        baseUrl: context.modelBaseUrl,
                        apiKeyEnv: "BENCH_KEY",
                        capabilities: { contextWindow: window, nativeTools: tools },
                    }
                    const fixed = await cli(set("model.main", JSON.stringify(role)), env)
                    if (fixed.ok) continue
                }
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

// ── Other harnesses, each in its own container (never installed on the host) ──────────────────

const IMAGES = join(ROOT, "scripts", "bench", "images")

async function run(
    argv: readonly string[],
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    const child = Bun.spawn([...argv], { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    return { ok: code === 0, stdout, stderr }
}

/** The proxy and tool server bind the host's loopback; a container reaches it by this name. */
export function forContainer(url: string): string {
    return url.replace(/\/\/(127\.0\.0\.1|localhost)(?=[:/])/, "//host.docker.internal")
}

/** A harness living in one container: built from its Dockerfile, set up once, one exec per turn. */
interface Contained {
    readonly image: string
    readonly dockerfile: string
    /** Shell commands, run in order, that set the harness up the way its own docs say to. */
    setup(context: HarnessContext): string[]
    /** One turn: the argv to run inside the container. `issued` is the harness's own id for `session`, once it has given one. */
    turn(text: string, session: string, issued: string | undefined): string[]
    /** The reply from that turn's output; `session` is what the next turn needs, if it differs. */
    read(out: { stdout: string; stderr: string }): { reply: string; session?: string }
}

function containedHarness(name: string, spec: Contained): Harness {
    const container = `bench-${name}-${process.pid}`
    // The harness's own session id, when it issues one rather than taking ours.
    const sessions = new Map<string, string>()
    const exec = (argv: readonly string[]) =>
        // `timeout` inside the container: killing a `docker exec` client leaves the process running.
        run(["docker", "exec", container, "timeout", String(TURN_TIMEOUT_MS / 1000), ...argv])
    return {
        name,
        async prepare(context) {
            const built = await run([
                "docker",
                "build",
                "-q",
                "-t",
                spec.image,
                "-f",
                join(IMAGES, spec.dockerfile),
                IMAGES,
            ])
            if (!built.ok)
                throw new Error(
                    `${name}: docker build failed:\n${built.stderr}\n  hint: is Docker running? \`docker version\` answers when it is.`,
                )
            await run(["docker", "rm", "-f", container])
            const started = await run([
                "docker",
                "run",
                "-d",
                "--rm",
                "--name",
                container,
                "--add-host",
                "host.docker.internal:host-gateway",
                spec.image,
            ])
            if (!started.ok)
                throw new Error(
                    `${name}: docker run failed:\n${started.stderr}\n  hint: docker ps -a shows a leftover ${container}.`,
                )
            for (const command of spec.setup(context)) {
                const result = await exec(["sh", "-c", command])
                if (!result.ok)
                    throw new Error(
                        `${name} setup failed at \`${command}\`:\n${result.stderr || result.stdout}\n  hint: docker exec -it ${container} sh, and run it by hand.`,
                    )
            }
        },
        async turn(text, session) {
            const result = await exec(spec.turn(text, session, sessions.get(session)))
            const read = spec.read(result)
            if (read.session !== undefined) sessions.set(session, read.session)
            return {
                reply: read.reply,
                ok: result.ok,
                detail: (result.stderr || result.stdout).trim(),
            }
        },
        async close() {
            await run(["docker", "rm", "-f", container])
        },
    }
}

/** `finalAssistantVisibleText` from `openclaw agent --json`, wherever the version nests it. */
export function openclawReply(stdout: string): string {
    const start = stdout.indexOf("{")
    if (start === -1) return stdout.trim()
    const find = (value: unknown): string | undefined => {
        if (value === null || typeof value !== "object") return undefined
        const record = value as Record<string, unknown>
        if (typeof record.finalAssistantVisibleText === "string")
            return record.finalAssistantVisibleText
        for (const child of Object.values(record)) {
            const found = find(child)
            if (found !== undefined) return found
        }
        return undefined
    }
    try {
        return find(JSON.parse(stdout.slice(start))) ?? ""
    } catch {
        return stdout.trim()
    }
}

/** `hermes chat -Q` prints the reply, a `session_id:` line and the odd `⚠` notice, across both streams. */
export function hermesOutput(out: { stdout: string; stderr: string }): {
    reply: string
    session?: string
} {
    const session = `${out.stdout}\n${out.stderr}`.match(/^session_id:\s*(\S+)/m)?.[1]
    const reply = out.stdout
        .split("\n")
        .filter((line) => !/^\s*(session_id:|⚠)/.test(line))
        .join("\n")
        .trim()
    return { reply, ...(session === undefined ? {} : { session }) }
}

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

const OPENCLAW: Contained = {
    image: "bench-openclaw:2026.10.5",
    dockerfile: "openclaw.Dockerfile",
    setup: (context) => [
        [
            "openclaw onboard --non-interactive --accept-risk --mode local --flow quickstart",
            "--auth-choice custom-api-key --custom-compatibility openai",
            `--custom-base-url ${quote(forContainer(context.modelBaseUrl))}`,
            `--custom-model-id ${quote(context.model.id)} --custom-api-key dummy --custom-text-input`,
            "--no-install-daemon --skip-channels --skip-skills",
        ].join(" "),
        `openclaw mcp add bench --url ${quote(forContainer(context.mcpUrl))} --transport streamable-http`,
        // Bench tools only, through its own policy (docs/gateway/config-tools/tool-policy.md): the
        // minimal profile plus the MCP server glob, and its memory tools as the other arms keep theirs.
        "openclaw config set tools.profile minimal",
        `openclaw config set tools.alsoAllow '["bench__*","group:memory"]' --strict-json`,
    ],
    turn: (text, session) => [
        "openclaw",
        "agent",
        "--local",
        "--agent",
        "main",
        "--session-id",
        session,
        "--message",
        text,
        "--json",
    ],
    read: ({ stdout }) => ({ reply: openclawReply(stdout) }),
}

const HERMES: Contained = {
    image: "bench-hermes:0.19.0",
    dockerfile: "hermes.Dockerfile",
    setup: (context) => [
        // The commands its own `hermes setup --non-interactive` prints for a custom endpoint.
        "hermes config set model.provider custom",
        `hermes config set model.base_url ${quote(forContainer(context.modelBaseUrl))}`,
        `hermes config set model.default ${quote(context.model.id)}`,
        'echo OPENAI_API_KEY=dummy >> "$(hermes config env-path)"',
        // `hermes mcp add` needs a terminal; this is the documented config.yaml form.
        `printf 'mcp_servers:\\n  bench:\\n    url: %s\\n' ${quote(forContainer(context.mcpUrl))} >> "$(hermes config path)"`,
        // Bench tools only: everything that reaches the same effect outside the graded world is off.
        "hermes tools disable terminal file code_execution web browser computer_use delegation cronjob image_gen tts vision",
        // The reply only, as the other arms run with --no-reasoning.
        "hermes config set display.show_reasoning false",
    ],
    // Hermes issues its own session id on the first turn; later turns resume it.
    turn: (text, _session, issued) =>
        issued === undefined
            ? ["hermes", "chat", "-Q", "-q", text]
            : ["hermes", "chat", "-Q", "--resume", issued, "-q", text],
    read: hermesOutput,
}

export const HARNESSES: Readonly<Record<string, Harness>> = {
    openclaw: containedHarness("openclaw", OPENCLAW),
    hermes: containedHarness("hermes", HERMES),
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

async function published(model: RosterModel): Promise<{ window: number; tools: boolean }> {
    const response = await fetch(`${model.baseUrl}/models/${model.id}/endpoints`)
    const json = (await response.json()) as {
        data?: {
            endpoints?: {
                tag?: string
                provider_name?: string
                context_length?: number
                supported_parameters?: string[]
            }[]
        }
    }
    const endpoint = json.data?.endpoints?.find(
        (e) => (e.tag ?? e.provider_name) === model.provider,
    )
    if (endpoint?.context_length === undefined)
        throw new Error(
            `No published endpoint data for ${model.id} on ${model.provider}.\n  hint: bun scripts/roster.ts --check confirms the pin still exists.`,
        )
    return {
        window: endpoint.context_length,
        tools: endpoint.supported_parameters?.includes("tools") === true,
    }
}
