/**
 * One adapter per harness in the head-to-head. Each runs in its own container — this runtime in the
 * image it ships as, the others in images built from their own install instructions — and is set up
 * the way its own setup would: for this runtime, `init --yes` and then the person's own `config set`.
 * Each is pointed at the proxy and the tool server, and answers one turn as one `docker exec`.
 *
 * The proxy is reached under the **upstream's own host name** (`openrouter.ai`, mapped to the host in
 * every container). Harnesses decide things from that name: this runtime and Hermes both send Claude's
 * `cache_control` only to `openrouter.ai`, and behind a loopback address neither did.
 */
import { join } from "node:path"
import { BRAND } from "../../packages/core/src/brand.ts"
import type { RosterModel } from "../lib/roster.ts"
import type { Harness, HarnessContext } from "./run.ts"

const ROOT = join(import.meta.dirname, "..", "..")
const IMAGES = join(ROOT, "scripts", "bench", "images")
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

type Result = { ok: boolean; stdout: string; stderr: string }

async function run(argv: readonly string[]): Promise<Result> {
    const child = Bun.spawn([...argv], { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    return { ok: code === 0, stdout, stderr }
}

const LOOPBACK = /\/\/(127\.0\.0\.1|localhost)(?=[:/])/

/** The proxy and tool server bind the host's loopback; a container reaches it by this name. */
export function forContainer(url: string): string {
    return url.replace(LOOPBACK, "//host.docker.internal")
}

/**
 * The host name a container should reach the model proxy by: the upstream's own, so a harness sees
 * the endpoint it would in real use. A local upstream (Ollama) has none worth keeping.
 */
export function upstreamHost(model: RosterModel): string {
    const host = new URL(model.baseUrl).hostname
    return host === "127.0.0.1" || host === "localhost" ? "host.docker.internal" : host
}

/** The proxy's URL as a container sees it, under `host`. */
export function modelUrlFor(url: string, host: string): string {
    return url.replace(LOOPBACK, `//${host}`)
}

/** A harness living in one container: built once, set up once, one exec per turn. */
interface Contained {
    readonly image: string
    /** `docker build` arguments after `-t <image>`: the Dockerfile and the context. */
    readonly build: readonly string[]
    /** Where the harness keeps every byte of its state, snapshotted after setup and restored per run. */
    readonly home: string
    /** Overrides the image's own entrypoint so the container idles between execs. */
    readonly entrypoint?: string
    /** Passed to every exec. */
    readonly env?: Readonly<Record<string, string>>
    /** Set the harness up the way its own docs say to. `sh` runs one shell command in the container. */
    setup(
        context: HarnessContext,
        model: string,
        sh: (command: string) => Promise<Result>,
    ): Promise<void>
    /** One turn: the argv to run inside the container. `issued` is the harness's own id for `session`, once it has given one. */
    turn(text: string, session: string, issued: string | undefined): string[]
    /** The reply from that turn's output; `session` is what the next turn needs, if it differs. */
    read(out: Result): { reply: string; session?: string }
}

function containedHarness(name: string, spec: Contained): Harness {
    const container = `bench-${name}-${process.pid}`
    // The harness's own session id, when it issues one rather than taking ours.
    const sessions = new Map<string, string>()
    const env = Object.entries(spec.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`])
    const exec = (argv: readonly string[]) =>
        // `timeout` inside the container: killing a `docker exec` client leaves the process running.
        run([
            "docker",
            "exec",
            ...env,
            container,
            "timeout",
            String(TURN_TIMEOUT_MS / 1000),
            ...argv,
        ])
    const sh = (command: string) => exec(["sh", "-c", command])
    return {
        name,
        async prepare(context) {
            const built = await run(["docker", "build", "-q", "-t", spec.image, ...spec.build])
            if (!built.ok)
                throw new Error(
                    `${name}: docker build failed:\n${built.stderr}\n  hint: is Docker running? \`docker version\` answers when it is.`,
                )
            await run(["docker", "rm", "-f", container])
            const host = upstreamHost(context.model)
            const started = await run([
                "docker",
                "run",
                "-d",
                "--rm",
                "--name",
                container,
                "--add-host",
                "host.docker.internal:host-gateway",
                ...(host === "host.docker.internal" ? [] : ["--add-host", `${host}:host-gateway`]),
                ...(spec.entrypoint === undefined ? [] : ["--entrypoint", spec.entrypoint]),
                spec.image,
                ...(spec.entrypoint === undefined ? [] : ["infinity"]),
            ])
            if (!started.ok)
                throw new Error(
                    `${name}: docker run failed:\n${started.stderr}\n  hint: docker ps -a shows a leftover ${container}.`,
                )
            await spec.setup(context, modelUrlFor(context.modelBaseUrl, host), sh)
            const snapshot = await sh(`tar -C ${spec.home} -cf /tmp/pristine.tar .`)
            if (!snapshot.ok)
                throw new Error(`${name}: could not snapshot ${spec.home}:\n${snapshot.stderr}`)
        },
        async reset() {
            sessions.clear()
            const restored = await sh(
                `find ${spec.home} -mindepth 1 -delete && tar -C ${spec.home} -xf /tmp/pristine.tar`,
            )
            if (!restored.ok)
                throw new Error(
                    `${name}: could not restore ${spec.home}:\n${restored.stderr}\n  hint: docker exec -it ${container} ls -l /tmp/pristine.tar`,
                )
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

/** Runs each command in order and stops at the first that fails, naming it. */
async function steps(
    name: string,
    commands: readonly string[],
    sh: (command: string) => Promise<Result>,
): Promise<void> {
    for (const command of commands) {
        const result = await sh(command)
        if (!result.ok)
            throw new Error(
                `${name} setup failed at \`${command}\`:\n${result.stderr || result.stdout}\n  hint: run it by hand with docker exec in the bench container.`,
            )
    }
}

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

// ── This runtime ──────────────────────────────────────────────────────────────────────────────

interface Variant {
    readonly dialect: "nlt" | "native"
    /** Authorise the three bench writes past the write gate, as the generated comment says to. */
    readonly allowWrites: boolean
}

const AGENT = "/home/dispach/bench/agent"
const MANIFEST = `${AGENT}/agent.yaml`
const STORE = "/home/dispach/bench/store.db"

function runtimeSpec(name: string, variant: Variant): Contained {
    const bin = BRAND.slug
    const set = (path: string, value: string) =>
        `${bin} config set ${MANIFEST} ${path} ${quote(value)} --plain --yes`
    return {
        // The image this runtime ships as, built from the working tree.
        image: "bench-runtime:local",
        build: ["-f", join(ROOT, "docker", "Dockerfile"), ROOT],
        home: "/home/dispach",
        entrypoint: "sleep",
        env: { [`${BRAND.envPrefix}NO_BOOTSTRAP`]: "1", BENCH_KEY: "dummy" },
        async setup(context, modelUrl, sh) {
            const mcpUrl = forContainer(context.mcpUrl)
            const init = [
                `${bin} init --yes --plain --name bench --user bench --preset custom`,
                `--model ${quote(context.model.id)} --base-url ${quote(modelUrl)} --api-key-env BENCH_KEY`,
                `--system none --web none --server none --skills none --dir ${AGENT}`,
            ].join(" ")
            const first = await sh(init)
            // A model the capability registry does not know gets an 8k window, which init's own
            // reserveOutput does not fit, so the agent it wrote does not load. Do what the error tells
            // a person to: declare the window — the pinned endpoint's published one.
            if (!first.ok && `${first.stdout}${first.stderr}`.includes("context.reserveOutput")) {
                const { window, tools } = await published(context.model)
                console.log(
                    `note: ${name} — the registry does not know ${context.model.id}; init's agent did not load, so its window (${window}) and native tool support (${tools}) were set from ${context.model.provider}'s published endpoint through config set model.main.`,
                )
                const role = {
                    id: context.model.id,
                    baseUrl: modelUrl,
                    apiKeyEnv: "BENCH_KEY",
                    capabilities: { contextWindow: window, nativeTools: tools },
                }
                await steps(name, [set("model.main", JSON.stringify(role))], sh)
            } else if (!first.ok) {
                throw new Error(`${name} setup failed at init:\n${first.stderr || first.stdout}`)
            }
            await steps(
                name,
                [
                    set(
                        "tools.providers",
                        JSON.stringify({
                            system: {},
                            web: {},
                            composio: {},
                            mcp: { servers: { bench: { url: mcpUrl } } },
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
                    `${bin} tools ${MANIFEST} --warm --plain`,
                ],
                sh,
            )
        },
        turn: (text, session) => [
            bin,
            "run",
            MANIFEST,
            "--input",
            text,
            "--session",
            `local:${session}`,
            "--store",
            STORE,
            "--plain",
            "--quiet",
            "--no-reasoning",
        ],
        // `--quiet` keeps the reply's own heading; it is chrome, not the answer.
        read: ({ stdout }) => ({ reply: stdout.replace(/^\s*· reply ·\s*/, "").trim() }),
    }
}

// ── Other harnesses ───────────────────────────────────────────────────────────────────────────

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

const OPENCLAW: Contained = {
    image: "bench-openclaw:2026.10.5",
    build: ["-f", join(IMAGES, "openclaw.Dockerfile"), IMAGES],
    home: "/root",
    setup: (context, modelUrl, sh) =>
        steps(
            "openclaw",
            [
                [
                    "openclaw onboard --non-interactive --accept-risk --mode local --flow quickstart",
                    "--auth-choice custom-api-key --custom-compatibility openai",
                    `--custom-base-url ${quote(modelUrl)}`,
                    `--custom-model-id ${quote(context.model.id)} --custom-api-key dummy --custom-text-input`,
                    "--no-install-daemon --skip-channels --skip-skills",
                ].join(" "),
                // Its documented opt-in for a public-looking host that resolves to a private address,
                // which is what openrouter.ai mapped to the proxy is; its SSRF guard refuses it otherwise.
                // The provider id is derived from host and port, so it is read back rather than rebuilt.
                `openclaw config set "models.providers.$(node -p 'Object.keys(require(process.env.HOME + "/.openclaw/openclaw.json").models.providers)[0]').request.allowPrivateNetwork" true --strict-json`,
                `openclaw mcp add bench --url ${quote(forContainer(context.mcpUrl))} --transport streamable-http`,
                // Bench tools only, through its own policy (docs/gateway/config-tools/tool-policy.md):
                // the minimal profile plus the MCP server glob, and its memory tools as the other arms
                // keep theirs.
                "openclaw config set tools.profile minimal",
                `openclaw config set tools.alsoAllow '["bench__*","group:memory"]' --strict-json`,
            ],
            sh,
        ),
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
    build: ["-f", join(IMAGES, "hermes.Dockerfile"), IMAGES],
    home: "/root",
    // Under openrouter.ai its resolver wants this key from the environment, as of any OpenRouter user,
    // and refuses an obvious placeholder such as "dummy" (`has_usable_secret`).
    // The proxy holds the real one.
    env: { OPENROUTER_API_KEY: "bench-key-not-real" },
    setup: (context, modelUrl, sh) =>
        steps(
            "hermes",
            [
                // The commands its own `hermes setup --non-interactive` prints for a custom endpoint.
                "hermes config set model.provider custom",
                `hermes config set model.base_url ${quote(modelUrl)}`,
                `hermes config set model.default ${quote(context.model.id)}`,
                'echo OPENAI_API_KEY=dummy >> "$(hermes config env-path)"',
                // `hermes mcp add` needs a terminal; this is the documented config.yaml form.
                `printf 'mcp_servers:\\n  bench:\\n    url: %s\\n' ${quote(forContainer(context.mcpUrl))} >> "$(hermes config path)"`,
                // Bench tools only: everything that reaches the same effect outside the graded world is off.
                "hermes tools disable terminal file code_execution web browser computer_use delegation cronjob image_gen tts vision",
                // The reply only, as the other arms run with --no-reasoning.
                "hermes config set display.show_reasoning false",
            ],
            sh,
        ),
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
    [`${BRAND.slug}-nlt`]: containedHarness(
        `${BRAND.slug}-nlt`,
        runtimeSpec(`${BRAND.slug}-nlt`, { dialect: "nlt", allowWrites: true }),
    ),
    [`${BRAND.slug}-native`]: containedHarness(
        `${BRAND.slug}-native`,
        runtimeSpec(`${BRAND.slug}-native`, { dialect: "native", allowWrites: true }),
    ),
    [`${BRAND.slug}-nlt-strict`]: containedHarness(
        `${BRAND.slug}-nlt-strict`,
        runtimeSpec(`${BRAND.slug}-nlt-strict`, { dialect: "nlt", allowWrites: false }),
    ),
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
