/**
 * A real run, captured 2026-10-20 against deepseek-v4-pro on a throwaway local server. Request
 * bodies are shortened; every response line is what the server returned. Client one's connection
 * was cut at two seconds (curl --max-time 2) while the model was still answering.
 */
export type Line = { kind: "cmd" | "out" | "note"; text: string }

export const capturedAt = "2026-10-20"
export const capturedModel = "deepseek-v4-pro"

export const replay: Line[] = [
    { kind: "cmd", text: `curl -X POST $HOST/v1/agents -d '{"answers":{"name":"milo",…}}'` },
    { kind: "out", text: `201 {"id":"milo","adopted":["milo"]}` },
    { kind: "note", text: "live now, no restart" },
    {
        kind: "cmd",
        text: `curl -X POST $HOST/v1/agents/milo/messages -d '{"text":"Why do lighthouses flash?"}'`,
    },
    { kind: "out", text: `202 {"turnId":"t_mvgsxxgj9rkl50u7","sessionKey":"api:default"}` },
    { kind: "cmd", text: "curl -N $HOST/v1/agents/milo/turns/t_mvgsxxgj9rkl50u7/stream" },
    { kind: "out", text: "event: turn.start" },
    { kind: "out", text: "event: model.call" },
    { kind: "note", text: "connection dropped at 2 s, mid-answer" },
    { kind: "cmd", text: "curl $HOST/v1/agents/milo/turns/t_mvgsxxgj9rkl50u7" },
    { kind: "out", text: `{"status":"running",…}` },
    { kind: "note", text: "the turn kept going without its client" },
    { kind: "cmd", text: "curl -N $HOST/v1/agents/milo/turns/t_mvgsxxgj9rkl50u7/stream" },
    { kind: "out", text: "event: stream.replay" },
    { kind: "out", text: "event: model.result" },
    {
        kind: "out",
        text: `event: turn.end {"reason":"final","durationMs":4095,"finalText":"Lighthouses flash so each one can be identified by its own unique pattern of light and dark…"}`,
    },
]
