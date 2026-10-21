import { randomBytes } from "node:crypto"
import { BRAND } from "./brand.ts"

export interface Guest {
    readonly id: string
    /** What the guest's agent sends as its API key. Worthless outside this broker. */
    readonly token: string
    readonly createdAt: number
    lastActiveAt: number
    tokensUsed: number
}

export interface Budgets {
    /** Model tokens one guest may spend over its whole session. */
    readonly perGuest: number
    /** Model tokens every guest together may spend in one UTC day: the bill's ceiling. */
    readonly daily: number
}

/** Why a call is refused, in the words the guest's terminal will show. */
export interface Refusal {
    readonly code: "guest_budget_exhausted" | "daily_budget_exhausted"
    readonly message: string
}

/**
 * Live guests and what they have spent. In memory on purpose: a guest lives minutes, and a broker
 * restart reaps every silo anyway.
 */
// ponytail: the daily total resets if the broker restarts; persist it if restarts become routine.
export class Guests {
    readonly #byToken = new Map<string, Guest>()
    readonly #budgets: Budgets
    readonly #now: () => number
    #day = ""
    #dailyUsed = 0

    constructor(budgets: Budgets, now: () => number = Date.now) {
        this.#budgets = budgets
        this.#now = now
    }

    add(id: string): Guest {
        const now = this.#now()
        const guest: Guest = {
            id,
            token: `${BRAND.tokenPrefix}${randomBytes(24).toString("base64url")}`,
            createdAt: now,
            lastActiveAt: now,
            tokensUsed: 0,
        }
        this.#byToken.set(guest.token, guest)
        return guest
    }

    byToken(token: string): Guest | undefined {
        return this.#byToken.get(token)
    }

    remove(id: string): void {
        for (const [token, guest] of this.#byToken) if (guest.id === id) this.#byToken.delete(token)
    }

    all(): readonly Guest[] {
        return [...this.#byToken.values()]
    }

    /** Checked before a call is forwarded. A call already in flight is allowed to finish. */
    refusal(guest: Guest): Refusal | undefined {
        if (guest.tokensUsed >= this.#budgets.perGuest)
            return {
                code: "guest_budget_exhausted",
                message: `This guest session has used its ${this.#budgets.perGuest.toLocaleString("en")}-token budget. Start a new session to keep going, or run ${BRAND.name} yourself: there is no budget on your own machine.`,
            }
        this.#rollDay()
        if (this.#dailyUsed >= this.#budgets.daily)
            return {
                code: "daily_budget_exhausted",
                message: `Today's guest budget is spent across every visitor. It resets at 00:00 UTC, or run ${BRAND.name} yourself in the meantime.`,
            }
        return undefined
    }

    charge(guest: Guest, tokens: number): void {
        this.#rollDay()
        guest.tokensUsed += tokens
        guest.lastActiveAt = this.#now()
        this.#dailyUsed += tokens
    }

    #rollDay(): void {
        const day = new Date(this.#now()).toISOString().slice(0, 10)
        if (day !== this.#day) {
            this.#day = day
            this.#dailyUsed = 0
        }
    }
}
