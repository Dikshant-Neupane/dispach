/**
 * The head-to-head task suite: 25 tasks over the bench tool server's world, six categories. Each
 * task is a world to load, the turns a person sends, and a grader over the world's final state and
 * the last reply — string and state checks only, never a model judging a model.
 *
 * Every task also carries an `oracle`: one trace that passes. The tests replay it through the real
 * server, so a task nobody could pass is a failing build, and they check that doing nothing with an
 * empty reply fails every task, so no grader is satisfied by absence.
 */
import type { World, WorldState } from "./tools-server.ts"

export type Category = "single" | "chain" | "recall" | "abstention" | "recovery" | "long"

export interface Task {
    readonly id: string
    readonly category: Category
    readonly world: World
    /** Sent in order as one conversation; the reply graded is the last one. */
    readonly turns: readonly string[]
    /** The reason it failed, or undefined for a pass. */
    readonly grade: (state: WorldState, reply: string) => string | undefined
    readonly oracle: {
        readonly calls: readonly [string, Record<string, string>][]
        readonly reply: string
    }
}

const MUTATING = new Set(["kv_set", "write_file", "send_message"])

const has = (text: string, needle: string) => text.toLowerCase().includes(needle.toLowerCase())
/** A number in prose, with thousands separators removed, as a whole token. */
const hasNumber = (text: string, n: string) =>
    new RegExp(`(^|[^\\d.])${n.replace(".", "\\.")}([^\\d]|$)`).test(
        text.replace(/(\d),(?=\d{3})/g, "$1"),
    )
const called = (s: WorldState, tool: string) => s.calls.filter((c) => c.tool === tool)
const succeeded = (s: WorldState, tool: string) => called(s, tool).some((c) => !c.isError)
const mutations = (s: WorldState) => s.calls.filter((c) => MUTATING.has(c.tool))
const messageTo = (s: WorldState, name: string) => s.messages.find((m) => has(m.to, name))

/** Checks in order; the first failure is the reason. */
function all(...checks: [boolean, string][]): string | undefined {
    return checks.find(([ok]) => !ok)?.[1]
}

const replied = (reply: string): [boolean, string] => [reply.trim() !== "", "empty reply"]

// Deterministic fixtures for the long-observation tasks: a seeded LCG, so every run sees the same bytes.
function lcg(seed: number) {
    let x = seed
    return () => {
        x = (x * 1103515245 + 12345) % 2 ** 31
        return x / 2 ** 31
    }
}

const LOG_LINES = 1200
const NEEDLE_LINE = 821
const appLog = (() => {
    const r = lcg(7)
    const services = ["api", "auth", "search", "billing", "cache"]
    const lines: string[] = []
    for (let i = 1; i <= LOG_LINES; i += 1) {
        const ts = `2026-03-14T0${Math.floor(i / 1000)}:${String(i % 60).padStart(2, "0")}:00Z`
        lines.push(
            i === NEEDLE_LINE
                ? `${ts} ERROR payment-gateway timeout after 30000ms code=E-4471`
                : `${ts} INFO ${services[Math.floor(r() * services.length)]} request ok in ${Math.floor(r() * 400)}ms`,
        )
    }
    return lines.join("\n")
})()

const STATUSES = [
    "delivered",
    "shipped",
    "processing",
    "delivered",
    "refunded",
    "delivered",
    "shipped",
]
const bulkOrders = (() => {
    const r = lcg(42)
    return Array.from({ length: 400 }, (_, i) => ({
        id: `B-${3000 + i}`,
        status: STATUSES[Math.floor(r() * STATUSES.length)] as string,
        total: Math.round(r() * 50000) / 100,
    }))
})()
const refundedCount = String(bulkOrders.filter((o) => o.status === "refunded").length)

const handbook = (() => {
    const r = lcg(3)
    const topics = [
        "Leave",
        "Equipment",
        "Travel",
        "Security",
        "Onboarding",
        "Remote work",
        "Training",
    ]
    const sections: string[] = []
    for (let i = 0; i < 60; i += 1) {
        const topic = `${topics[i % topics.length]} ${Math.floor(i / topics.length) + 1}`
        const body = Array.from(
            { length: 12 },
            (_, j) =>
                `Policy ${i}.${j}: requests are reviewed within ${2 + Math.floor(r() * 9)} working days.`,
        )
        sections.push(`## ${topic}\n\n${body.join("\n")}`)
        if (i === 37)
            sections.push(
                "## Expenses\n\nMeals while travelling are reimbursed up to a limit of 75 EUR per day, receipts required.",
            )
    }
    return `# Employee handbook\n\n${sections.join("\n\n")}`
})()

const weekday = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
const CLOCK = "2026-03-14T09:30:00Z"

export const TASKS: readonly Task[] = [
    // ── single: one call, one argument set ──
    {
        id: "single-kv-set",
        category: "single",
        world: {},
        turns: ["Remember that my locker code is 4417. Store it under the key locker_code."],
        grade: (s, reply) =>
            all(replied(reply), [
                s.kv.locker_code?.trim() === "4417",
                "locker_code not stored as 4417",
            ]),
        oracle: { calls: [["kv_set", { key: "locker_code", value: "4417" }]], reply: "Saved." },
    },
    {
        id: "single-read-answer",
        category: "single",
        world: { files: { "notes/meeting.md": "Standup moved to Thursday 10:15 in room Birch." } },
        turns: ["What room is the standup in? It's in notes/meeting.md."],
        grade: (s, reply) =>
            all(
                [succeeded(s, "read_file"), "file never read"],
                [has(reply, "birch"), "room not in reply"],
            ),
        oracle: { calls: [["read_file", { path: "notes/meeting.md" }]], reply: "Room Birch." },
    },
    {
        id: "single-calculator",
        category: "single",
        world: {},
        turns: ["What is 1234 multiplied by 5678? Use the calculator."],
        grade: (s, reply) =>
            all(
                [succeeded(s, "calculator"), "calculator not used"],
                [hasNumber(reply, "7006652"), "wrong product"],
            ),
        oracle: { calls: [["calculator", { expression: "1234 * 5678" }]], reply: "7,006,652" },
    },
    {
        id: "single-now",
        category: "single",
        world: { clock: CLOCK },
        turns: ["What day of the week is it today?"],
        grade: (s, reply) =>
            all(
                [succeeded(s, "now"), "clock not read (a guess)"],
                [has(reply, weekday(CLOCK)), "wrong weekday"],
            ),
        oracle: { calls: [["now", {}]], reply: `It's ${weekday(CLOCK)}.` },
    },
    {
        id: "single-send",
        category: "single",
        world: {},
        turns: ["Send Priya a message saying the build is green."],
        grade: (s, reply) =>
            all(replied(reply), [
                has(messageTo(s, "priya")?.text ?? "", "green"),
                "no message to Priya about the build",
            ]),
        oracle: {
            calls: [["send_message", { to: "Priya", text: "The build is green." }]],
            reply: "Sent.",
        },
    },

    // ── chain: a result feeds the next call ──
    {
        id: "chain-order-notify",
        category: "chain",
        world: { orders: [{ id: "A-1001", status: "delayed", total: 42, items: ["lamp"] }] },
        turns: ["Look up order A-1001 and message Sam with its status."],
        grade: (s, reply) =>
            all(
                replied(reply),
                [succeeded(s, "lookup_order"), "order never looked up"],
                [has(messageTo(s, "sam")?.text ?? "", "delayed"), "Sam not told it is delayed"],
            ),
        oracle: {
            calls: [
                ["lookup_order", { order_id: "A-1001" }],
                ["send_message", { to: "Sam", text: "Order A-1001 is delayed." }],
            ],
            reply: "Told Sam.",
        },
    },
    {
        id: "chain-file-to-kv",
        category: "chain",
        world: { files: { "config/app.env": "PORT=8080\nREGION=eu-west-2\nDEBUG=false" } },
        turns: ["Read config/app.env and store the region under the key region."],
        grade: (s, reply) =>
            all(replied(reply), [
                s.kv.region?.trim() === "eu-west-2",
                "region not stored as eu-west-2",
            ]),
        oracle: {
            calls: [
                ["read_file", { path: "config/app.env" }],
                ["kv_set", { key: "region", value: "eu-west-2" }],
            ],
            reply: "Stored eu-west-2.",
        },
    },
    {
        id: "chain-sum-to-file",
        category: "chain",
        world: { files: { "data/invoices.csv": "id,amount\n1,120.50\n2,79.25\n3,300.00" } },
        turns: [
            "Add up the amounts in data/invoices.csv and write just the total to reports/total.txt.",
        ],
        grade: (s, reply) =>
            all(replied(reply), [
                hasNumber(s.files["reports/total.txt"] ?? "", "499.75"),
                "reports/total.txt is not 499.75",
            ]),
        oracle: {
            calls: [
                ["read_file", { path: "data/invoices.csv" }],
                ["calculator", { expression: "120.50 + 79.25 + 300.00" }],
                ["write_file", { path: "reports/total.txt", content: "499.75" }],
            ],
            reply: "Wrote 499.75.",
        },
    },
    {
        id: "chain-kv-to-send",
        category: "chain",
        world: { kv: { on_call: "Dmitri" } },
        turns: [
            "Find out who is on call (it's under the key on_call) and send them: disk 91% on db-2.",
        ],
        grade: (s, reply) =>
            all(replied(reply), [
                has(messageTo(s, "dmitri")?.text ?? "", "91%"),
                "Dmitri not sent the alert",
            ]),
        oracle: {
            calls: [
                ["kv_get", { key: "on_call" }],
                ["send_message", { to: "Dmitri", text: "disk 91% on db-2" }],
            ],
            reply: "Sent to Dmitri.",
        },
    },
    {
        id: "chain-edit-json",
        category: "chain",
        world: { files: { "config/flags.json": '{"darkMode":false,"beta":true,"maxUploads":3}' } },
        turns: ["Turn darkMode on in config/flags.json and leave every other setting as it is."],
        grade: (s, reply) => {
            let flags: Record<string, unknown> = {}
            try {
                flags = JSON.parse(s.files["config/flags.json"] ?? "") as Record<string, unknown>
            } catch {
                return "config/flags.json is no longer valid JSON"
            }
            return all(
                replied(reply),
                [flags.darkMode === true, "darkMode not true"],
                [flags.beta === true && flags.maxUploads === 3, "another setting changed"],
            )
        },
        oracle: {
            calls: [
                ["read_file", { path: "config/flags.json" }],
                [
                    "write_file",
                    {
                        path: "config/flags.json",
                        content: '{"darkMode":true,"beta":true,"maxUploads":3}',
                    },
                ],
            ],
            reply: "Done.",
        },
    },

    // ── recall: a fact from an earlier turn is needed later ──
    {
        id: "recall-fact",
        category: "recall",
        world: {},
        turns: [
            "My flight is BA 286, landing at 14:20.",
            "Thanks. Now store my flight number under the key flight.",
        ],
        grade: (s, reply) =>
            all(replied(reply), [
                (s.kv.flight ?? "").replace(/\s/g, "").toUpperCase() === "BA286",
                "flight not stored as BA 286",
            ]),
        oracle: { calls: [["kv_set", { key: "flight", value: "BA 286" }]], reply: "Stored." },
    },
    {
        id: "recall-preference",
        category: "recall",
        world: {},
        turns: [
            "When you sign messages for me, sign them as Captain.",
            "Send Lee a note saying the deploy finished, signed the way I asked.",
        ],
        grade: (s, reply) => {
            const text = messageTo(s, "lee")?.text ?? ""
            return all(
                replied(reply),
                [has(text, "deploy"), "Lee not told about the deploy"],
                [has(text, "captain"), "not signed Captain"],
            )
        },
        oracle: {
            calls: [["send_message", { to: "Lee", text: "The deploy finished. Captain" }]],
            reply: "Sent.",
        },
    },
    {
        id: "recall-correction",
        category: "recall",
        world: {},
        turns: [
            "Store the meeting time as 15:00 under the key meeting.",
            "Sorry, I got that wrong, it's 16:30. Fix it.",
        ],
        grade: (s, reply) =>
            all(replied(reply), [
                s.kv.meeting?.includes("16:30") === true,
                "meeting not corrected to 16:30",
            ]),
        oracle: {
            calls: [
                ["kv_set", { key: "meeting", value: "15:00" }],
                ["kv_set", { key: "meeting", value: "16:30" }],
            ],
            reply: "Fixed.",
        },
    },

    // ── abstention: the right number of calls is zero, or zero writes ──
    {
        id: "abstain-chitchat",
        category: "abstention",
        world: {},
        turns: ["Hi! How's your day going?"],
        grade: (s, reply) =>
            all(replied(reply), [s.calls.length === 0, "called a tool for small talk"]),
        oracle: { calls: [], reply: "Going well, thanks!" },
    },
    {
        id: "abstain-knowledge",
        category: "abstention",
        world: {},
        turns: ["What's the capital of Japan?"],
        grade: (s, reply) =>
            all(
                [has(reply, "tokyo"), "wrong or no answer"],
                [s.calls.length === 0, "called a tool for general knowledge"],
            ),
        oracle: { calls: [], reply: "Tokyo." },
    },
    {
        id: "abstain-draft-only",
        category: "abstention",
        world: {},
        turns: [
            "Draft a message to Omar saying the report will be late. Don't send it, I want to read it first.",
        ],
        grade: (s, reply) =>
            all(
                [has(reply, "late"), "no draft in the reply"],
                [called(s, "send_message").length === 0, "sent it anyway"],
            ),
        oracle: { calls: [], reply: "Hi Omar, the report will be late. Sorry for the delay." },
    },
    {
        id: "abstain-cannot",
        category: "abstention",
        world: {},
        turns: ["Book me a table for two at Nopa tonight."],
        grade: (s, reply) =>
            all(replied(reply), [mutations(s).length === 0, "pretended with a write or message"]),
        oracle: { calls: [], reply: "I can't book restaurants with the tools I have." },
    },

    // ── recovery: a failure the agent must get past, or report honestly ──
    {
        id: "recover-retry",
        category: "recovery",
        world: {
            orders: [{ id: "A-2002", status: "shipped", total: 18, items: ["cable"] }],
            failures: { lookup_order: 1 },
        },
        turns: ["What's the status of order A-2002?"],
        grade: (s, reply) =>
            all(
                [succeeded(s, "lookup_order"), "never got past the failure"],
                [has(reply, "shipped"), "status not in reply"],
            ),
        oracle: {
            calls: [
                ["lookup_order", { order_id: "A-2002" }],
                ["lookup_order", { order_id: "A-2002" }],
            ],
            reply: "It has shipped.",
        },
    },
    {
        id: "recover-persist",
        category: "recovery",
        world: { failures: { write_file: 2 } },
        turns: ["Save the text 'ship it on Monday' to notes/decision.md."],
        grade: (s, reply) =>
            all(replied(reply), [
                has(s.files["notes/decision.md"] ?? "", "ship it on monday"),
                "file never written",
            ]),
        oracle: {
            calls: [
                ["write_file", { path: "notes/decision.md", content: "ship it on Monday" }],
                ["write_file", { path: "notes/decision.md", content: "ship it on Monday" }],
                ["write_file", { path: "notes/decision.md", content: "ship it on Monday" }],
            ],
            reply: "Saved.",
        },
    },
    {
        id: "recover-bad-expression",
        category: "recovery",
        world: {},
        turns: ["Using the calculator, what is 15% of 2,480?"],
        grade: (s, reply) =>
            all(
                [succeeded(s, "calculator"), "calculator never succeeded"],
                [hasNumber(reply, "372"), "wrong answer"],
            ),
        oracle: { calls: [["calculator", { expression: "0.15 * 2480" }]], reply: "372" },
    },
    {
        id: "recover-missing-file",
        category: "recovery",
        world: {},
        turns: ["Read notes/budget.md and store its total under the key budget."],
        grade: (s, reply) =>
            all(
                replied(reply),
                [called(s, "read_file").length > 0, "never tried to read the file"],
                [mutations(s).length === 0, "invented a value or file"],
            ),
        oracle: {
            calls: [["read_file", { path: "notes/budget.md" }]],
            reply: "There is no notes/budget.md, so I stored nothing.",
        },
    },
    {
        id: "recover-unknown-order",
        category: "recovery",
        world: { orders: [{ id: "A-1001", status: "delayed", total: 42, items: ["lamp"] }] },
        turns: ["Message Sam the status of order A-9999."],
        grade: (s, reply) =>
            all(
                replied(reply),
                [
                    called(s, "lookup_order").some((c) => c.args.order_id === "A-9999"),
                    "never looked the order up",
                ],
                [
                    !s.messages.some((m) => /shipped|delayed|delivered|processing/i.test(m.text)),
                    "told Sam a status that does not exist",
                ],
            ),
        oracle: {
            calls: [["lookup_order", { order_id: "A-9999" }]],
            reply: "There is no order A-9999, so I didn't message Sam.",
        },
    },

    // ── long: the answer is one line inside a large observation ──
    {
        id: "long-log-needle",
        category: "long",
        world: { files: { "logs/app.log": appLog } },
        turns: ["Find the error code in logs/app.log and store it under the key incident_code."],
        grade: (s, reply) =>
            all(replied(reply), [has(s.kv.incident_code ?? "", "E-4471"), "error code not stored"]),
        oracle: {
            calls: [
                ["read_file", { path: "logs/app.log" }],
                ["kv_set", { key: "incident_code", value: "E-4471" }],
            ],
            reply: "Stored E-4471.",
        },
    },
    {
        id: "long-count-orders",
        category: "long",
        world: { files: { "data/orders.json": JSON.stringify(bulkOrders, null, 1) } },
        turns: ["How many orders in data/orders.json have the status refunded?"],
        grade: (s, reply) =>
            all(
                [succeeded(s, "read_file"), "file never read"],
                [hasNumber(reply, refundedCount), `count is not ${refundedCount}`],
            ),
        oracle: {
            calls: [["read_file", { path: "data/orders.json" }]],
            reply: `${refundedCount} orders.`,
        },
    },
    {
        id: "long-handbook",
        category: "long",
        world: { files: { "docs/handbook.md": handbook } },
        turns: [
            "What's the daily meal expense limit in docs/handbook.md? Save the amount under the key meal_limit.",
        ],
        grade: (s, reply) =>
            all(replied(reply), [hasNumber(s.kv.meal_limit ?? "", "75"), "meal_limit is not 75"]),
        oracle: {
            calls: [
                ["read_file", { path: "docs/handbook.md" }],
                ["kv_set", { key: "meal_limit", value: "75 EUR" }],
            ],
            reply: "75 EUR per day.",
        },
    },
]
