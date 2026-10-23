/**
 * A step that ends the turn without doing what the turn needs: no visible reply after a tool result, or a
 * promise to act with no call (decision 14.123).
 *
 * Both were measured as the main way small and mid-size models fail here. qwen3.5-9b wrote its answer
 * inside its reasoning and emitted its end-of-turn token there, so 16 of its 49 failures had an empty
 * reply; Hermes saw the same on 114 of 498 responses and recovered by nudging once. Under NLT, Grok 4.7
 * wrote "I'll store it under `locker_code`." and stopped, writing the ACTION block on 0 of 8 replays of a
 * two-step task. The loop now answers that once with a framed note and gives up honestly after.
 */

import type { ChatMessage } from "../model/provider.ts"

export type Silence = "empty" | "promise"

/**
 * An announcement of the model's own next action as the last sentence. "Let me know" is a closing, not an
 * action, and a question is asking rather than promising, so neither counts.
 */
const PROMISE =
    /^(?:(?:ok(?:ay)?|now|next|first|sure)[,:]?\s+)?(?:i['’]ll|i will|let me|i['’]m going to|i am going to)\b(?!\s+know\b)/i

/** Why this step needs a nudge, or `undefined` when it is a reply. */
export function silenceOf(text: string, trace: readonly ChatMessage[]): Silence | undefined {
    const visible = text.trim()
    if (visible === "") {
        // A first-step empty reply is something else: the reasoning budget, which has its own error.
        return trace.some((message) => message.origin === "observation") ? "empty" : undefined
    }
    const sentences = visible.split(/(?<=[.!?])\s+/)
    const last = (sentences.at(-1) ?? "").trim()
    if (last.endsWith("?")) return undefined
    return PROMISE.test(last) ? "promise" : undefined
}

/** The note the loop sends, framed as the runtime's so it cannot read as the person's words. */
export const SILENCE_NOTE: Readonly<Record<Silence, string>> = {
    empty: "From the runtime, not the person: your last response had no visible text, so nothing reached them. You have the tool result above. Answer them now, or make the call you need.",
    promise:
        "From the runtime, not the person: you said you would do that, but no tool call was made, so nothing happened. Make the call now, or tell them plainly why you cannot.",
}
