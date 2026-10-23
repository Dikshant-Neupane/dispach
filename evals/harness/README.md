# Harness benchmark

25 multi-turn tasks (single call, chains, recall across turns, abstention, recovery from injected
tool failures, long files) run against a real model through the whole harness, graded by the tool
server's final state rather than by the reply's wording. Built so other harnesses can be run on the
same tasks, models and tools.

- **Tasks:** `scripts/bench/tasks.ts`, one oracle each.
- **Tools:** `scripts/bench/tools-server.ts`, an MCP server (Streamable HTTP) with 8 tools.
- **Models:** pinned to one provider each (`evals/models.json`, `allow_fallbacks: false`,
  `require_parameters: true`) through a recording proxy (`scripts/bench/proxy.ts`).
- **Setup:** `init --yes` and `config set`, the way a person would (`scripts/bench/adapters.ts`).
  The three bench write tools are in `policy.allow`.
- **Isolation (since 309fdf8):** every harness, this runtime included, runs in its own container
  (`docker/Dockerfile` for this runtime, `scripts/bench/images/` for the others), and its state is
  restored from a snapshot before every attempt. The 309fdf8 runs shared one agent per arm, so repeat 3
  of a task recalled repeats 1 and 2. The proxy is reached under the upstream's own host name
  (`openrouter.ai`, mapped to the host), because harnesses decide by it: this runtime, Hermes and
  OpenClaw all send Claude's `cache_control` only on an OpenRouter route. OpenClaw needs its documented
  `request.allowPrivateNetwork` opt-in for that, and Hermes a non-placeholder key in its environment.
- **Scoring:** an errored run scores 0 and stays in the denominator. A run lost to a 429 is re-run
  and counted as a retry. One still throttled after eight retries is run again after a cooldown, and if
  it is throttled even then it is marked `throttled` and left out of the rate (`f97d12e`), because it
  measures the provider. Intervals are Wilson 95%.

## Results

| Commit | Arm | Pass | 95% CI | Errored | Cost | Prompt tokens |
| --- | --- | --- | --- | --- | --- | --- |
| `aae8fe4` | native · GLM 5.3 | 88/125 (70%) | 62–78% | 15 | $4.55 | 4,574,714 |
| `aae8fe4` | native · GPT-6 Luna | 63/125 (50%) | 42–59% | 15 | $0.28 | 2,940,550 |
| `aae8fe4` | NLT · GLM 5.3 | 74/125 (59%) | 50–67% | 4 | $2.06 | 1,787,727 |
| `aae8fe4` | NLT · GPT-6 Luna | 46/125 (37%) | 29–46% | 10 | $0.12 | 1,213,230 |
| `ac5dcc5` | native · GLM 5.3 | 117/125 (94%) | 88–97% | 2 | $1.36 | 1,821,339 |
| `ac5dcc5` | native · GPT-6 Luna | 114/125 (91%) | 85–95% | 0 | $0.10 | 1,503,935 |
| `ac5dcc5` | NLT · GLM 5.3 | 91/125 (73%) | 64–80% | 0 | $0.97 | 1,176,596 |
| `ac5dcc5` | NLT · GPT-6 Luna | 75/125 (60%) | 51–68% | 0 | $0.10 | 1,280,279 |
| `8267f61` | native · GLM 5.3 | 118/125 (94%) | 89–97% | 1 | $1.34 | 1,823,382 |
| `8267f61` | native · GPT-6 Luna | 114/125 (91%) | 85–95% | 0 | $0.10 | 1,526,493 |
| `8267f61` | NLT · GLM 5.3 | 86/125 (69%) | 60–76% | 0 | $1.19 | 1,304,171 |
| `8267f61` | NLT · GPT-6 Luna | 82/125 (66%) | 57–73% | 0 | $0.11 | 1,344,305 |

`ac5dcc5` is decision 14.117: the fixes for what the `aae8fe4` baseline measured. `8267f61`
changes one thing, the MCP error hint, which had told the model never to retry even when the server
said "try again": `recover-retry` went 0→5 on GPT-6 Luna native. Per-category and per-task deltas are
in each run's `results.json`.

**Noise.** Between `ac5dcc5` and `8267f61` no other code changed, yet single tasks moved by up to
4 of 5 (GLM NLT `chain-file-to-kv` 4→1; Luna native `single-kv-set` 5→0, where the model refused to
store a "sensitive" locker code). Every arm-level change in that pair is inside both intervals. A
task-level difference of 3 in 5 on these hosted models is not a result.

## Model sweep (`4f3e00a`)

The same 25 tasks, n=5, on 2026-10-23, every arm on an image built from `git archive 4f3e00a` so no
uncommitted change reached it. Since `552660a` the runtime has gained:

- 14.123: one framed nudge when a step ends with no visible text after a tool result, or promises a
  call and makes none.
- 14.124–14.125: `init` writes the endpoint's measured window and `native` where the registry knows the
  model calls tools.
- 14.126: an observation's budget is a quarter of the window rather than a twentieth.
- 14.127 and 14.129: the repeat guard lets an identical call through twice after a failure the server
  called temporary, and the MCP hint says the same.
- 14.128: a nudge when the reply says something was saved or sent and nothing that acts ran.

| Model | Native | NLT | Native at `552660a` | Native cost |
| --- | --- | --- | --- | --- |
| Claude Opus 5.5 | 125/125 (100%) | 125/125 (100%) | 120 | $2.05 |
| Claude Sonnet 5.5 | 125/125 (100%) | 124/125 (99%) | 120 | $0.80 |
| GPT-6.1 Sol | 125/125 (100%) | 125/125 (100%) | 120 | $0.54 |
| GLM 5.3 | 125/125 (100%) | 119/125 (95%) | 120 | $0.80 |
| DeepSeek V4 Pro | 125/125 (100%) | 124/125 (99%) | 119 | $0.31 |
| Gemini 3.8 Flash | 125/125 (100%) | 119/125 (95%) | 115 | $1.38 |
| Claude Haiku 5.5 | 124/125 (99%) | 124/125 (99%) | 120 | $0.06 |
| Grok 4.7 | 124/125 (99%) | 62/125 (50%) | 118 | $1.53 |
| Gemini 4 Argon | 119/125 (95%) | 118/125 (94%) | 114 | $2.29 |
| Kimi K3 | 115/125 (92%) | 71/125 (57%) | 117 | $2.24 |
| GPT-6 Luna | 114/125 (91%) | 85/125 (68%) | 118 | $0.05 |
| Gemma 4 26B-A4B | 112/125 (90%) | 75/125 (60%) | 112 | $0.24 |
| qwen3.5-9b | 104/125 (83%) | in progress | 76 | $0.18 |
| gpt-oss-20b | 97/125 (78%) | 89/125 (71%) | 88 | $0.05 |

Intervals, per-category and per-task results are in `runs/sweep-4f3e00a/results.json`, with deltas
against `552660a`.

**Against the other harnesses.** The Hermes 0.19.0 and OpenClaw 2026.10.5 arms were not re-run: they
come from `runs/sweep-bfaf549/` (Claude and Argon), `runs/h2h-cachefix/` (Sol and GLM) and
`runs/sweep-552660a/` (the open models). The tasks, isolation and pinned providers are the same, and
nothing in this runtime's changes reaches them.

| Model | Dispach native | Hermes | OpenClaw |
| --- | --- | --- | --- |
| Opus 5.5 | 125 · $2.05 | 119 · $2.24 | 105 · $7.10 |
| Sonnet 5.5 | 125 · $0.80 | 120 · $1.76 | 105 · $4.21 |
| Haiku 5.5 | 124 · $0.06 | 120 · $0.07 | 102 · $0.21 |
| GPT-6.1 Sol | 125 · $0.54 | 120 · $0.53 | 95 · $1.73 |
| GLM 5.3 | 125 · $0.80 | 123 · $1.18 | 98 · $4.86 |
| DeepSeek V4 Pro | 125 · $0.31 | 120 · $0.50 | 96 · $2.83 |
| Gemini 4 Argon | 119 · $2.29 | 123 · $2.79 | 108 · $5.47 |
| Kimi K3 | 115 · $2.24 | 115 · $2.36 | 98 · $10.27 |
| Gemma 4 26B-A4B | 112 · $0.24 | 108 · $0.41 | 91 · $2.95 |
| qwen3.5-9b | 104 · $0.18 | 112 · $0.42 | 60 · $0.78 |
| gpt-oss-20b | 97 · $0.05 | 111 · $0.10 | 51 · $0.12 |

**Read plainly.**

- **Native:** 99–100% on eight of fourteen models, and 112/125 or better on twelve. `recover-persist`, which
  failed in every Dispach arm before, now passes, through the transient retry of 14.127 and 14.129.
- **Against Hermes:** Dispach is higher on seven models, level on Kimi, and lower on Argon, qwen3.5-9b and
  gpt-oss-20b. Every gap is inside the 95% intervals except gpt-oss-20b, where Hermes leads by 14 runs
  and the intervals only just touch (Dispach 70–84%, Hermes 82–93%).
- **Cost:** Dispach costs least on ten of eleven models, and is level with Hermes on Sol ($0.54 against
  $0.53).
- **OpenClaw** trails both on every model, by 11–60 runs.
- **NLT** matches native on the Claude models, Sol, DeepSeek and Argon. It falls on Grok 4.7 (50%),
  Kimi K3 (57%), Gemma (60%) and GPT-6 Luna (68%), so `native` stays the default `init` writes.
- **The small models are where the gap is.** gpt-oss-20b fails `chain-order-notify` 4 of 5 by asking
  "do you want me to send Sam the status?" instead of acting. On `recover-persist` it once said
  `file_write` "isn't enabled" when it was pinned, the same misreading of the "Not enabled for you" list
  seen on Luna and qwen.

**Errored rows**, read from the replies:

- *Grok 4.7 NLT (4) and Argon NLT (5):* `tool_repair_failed`, almost all "the block started in the
  middle of a line", meaning the model glued `…text.ACTION:` onto prose. The parser does not read that
  shape, and it is the open NLT follow-up.
- *Sonnet NLT (1):* the model wrote Anthropic's own `<invoke name=…>` markup instead of an `ACTION`
  block.
- *Gemma native (3):* provider 400s and a 503, scored as they would be for any harness.

**Throttling.** Before `f97d12e` the runner scored a run that ran out of four retries. That happened
to 8 Gemma rows in this sweep, and to most of the qwen3.5-9b spot checks that day, when nine qwen
shards shared one upstream. The Gemma rows were re-run on the same image; the rows they replaced are
in `*.throttled-orig.jsonl`. The spot checks are in `runs/remeasure-*/superseded-throttled/` and are
not results.

## Model sweep (`552660a`)

The same 25 tasks, n=5, on 2026-10-22, under the isolation above. This runtime at `552660a`: 14.120
(each framed user-role block says where it ends), 14.121 (init's third-party rule applies only when
the person has not said what to share) and 14.122 (a built-in pinned again under a namespace leaves
the catalogue). All three were found by the interim sweep at `bfaf549`, which is kept in
`runs/sweep-bfaf549/`. The runner fix `d1c217f` (an unreachable upstream is re-run, not scored) was in
place for the Kimi and gpt-oss arms; the arms it would have changed were re-run whole, and the
originals are in `runs/sweep-552660a/superseded-network/`.

| Model | Native | NLT | Native cost | NLT cost |
| --- | --- | --- | --- | --- |
| Claude Opus 5.5 | 120/125 (96%) | 119/125 (95%) | $1.89 | $2.34 |
| Claude Sonnet 5.5 | 120/125 (96%) | 120/125 (96%) | $0.78 | $1.02 |
| Claude Haiku 5.5 | 120/125 (96%) | 114/125 (91%) | $0.06 | $0.08 |
| GPT-6.1 Sol | 120/125 (96%) | 120/125 (96%) | $0.54 | $0.86 |
| GLM 5.3 | 120/125 (96%) | 103/125 (82%) | $0.92 | $0.84 |
| DeepSeek V4 Pro | 119/125 (95%) | 117/125 (94%) | $0.31 | $0.24 |
| GPT-6 Luna | 118/125 (94%) | 74/125 (59%) | $0.04 | $0.04 |
| Grok 4.7 | 118/125 (94%) | 46/125 (37%) | $1.47 | $1.18 |
| Kimi K3 | 117/125 (94%) | 66/125 (53%) | $2.35 | $0.99 |
| Gemini 3.8 Flash | 115/125 (92%) | 117/125 (94%) | $1.38 | $1.73 |
| Gemini 4 Argon | 114/125 (91%) | 116/125 (93%) | $1.98 | $2.45 |
| gpt-oss-20b | 88/125 (70%) | 74/125 (59%) | $0.04 | $0.04 |
| qwen3.5-9b | 76/125 (61%) | not measured | $0.14 | |

Intervals and per-category results are in `runs/sweep-552660a/results.json`. Hosted qwen3.5-9b under
NLT was stopped at 8/125: DeepInfra served it at about 16 tokens a second and four of the eight runs hit
the 300 s turn limit, which measures the endpoint rather than the model. The local Ollama arms
(qwen3.5:9b, gemma4:12b) were paused, not run.

**Against the other harnesses**, on the four anchors (Hermes and OpenClaw from `runs/sweep-bfaf549/`;
nothing in `552660a` changes them):

| Model | Dispach native | Hermes 0.19.0 | OpenClaw 2026.10.5 |
| --- | --- | --- | --- |
| Opus 5.5 | 120 (96%) · $1.89 | 119 (95%) · $2.24 | 105 (84%) · $7.10 |
| Sonnet 5.5 | 120 (96%) · $0.78 | 120 (96%) · $1.76 | 105 (84%) · $4.21 |
| Haiku 5.5 | 120 (96%) · $0.06 | 120 (96%) · $0.07 | 102 (82%) · $0.21 |
| Gemini 4 Argon | 114 (91%) · $1.98 | 123 (98%) · $2.79 | 108 (86%) · $5.47 |

**Read plainly.**

- Native Dispach scores 94–96% on nine of thirteen models, and its remaining failures there are almost
  entirely `recover-persist` (5 of 5, the repeat guard). Against Hermes it ties on the three Claude
  models and loses on Gemini 4 Argon by 9 runs, where four of its misses are miscounts of a 400-row file
  the model received complete. OpenClaw trails both by 12–18pp, losing all 15 long-file runs on each
  model to its own truncation.
- Dispach native is the cheapest of the three on Opus, Sonnet and Argon, and level with Hermes on
  Haiku. On Claude that is 14.119: without `cache_control` the same arms paid full price.
- NLT ties native on eight models and collapses on four: Grok 4.7 (37%), Kimi K3 (53%), GPT-6 Luna (59%)
  and gpt-oss-20b (59%), with GLM 5.3 at 82%. The mechanism, from the replies and from replaying the
  requests: the model writes "I'll do X" and ends its turn without the `ACTION` block. Replaying one
  Grok request, it wrote the block 5 of 8 times on a single call and 0 of 8 on a two-step chain. Native
  never loses to NLT by more than the noise; NLT loses to native by up to 72 runs.
- The two small open models are where native falls too: gpt-oss-20b 70%, qwen3.5-9b 61%. Below the
  frontier the dialect is not the only thing that matters, and no small model reached the band.

## Head-to-head (`bfaf549`)

The same 25 tasks, n=5, all arms on 2026-10-22, under the isolation described above: every harness
in its own container, its state restored before every attempt, the proxy reached as `openrouter.ai`.
This runtime is at `bfaf549`: decision 14.118 (only byte-stable slots are system messages) and 14.119
(`cache_control` for Claude on OpenRouter). The `309fdf8` table below is the "before".

| Harness · model | Pass | 95% CI | Errored | Cost | Prompt tokens | Cached | Median run |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Dispach native · GPT-6.1 Sol | 120/125 (96%) | 91–98% | 0 | $0.69 | 1,456,332 | 87% | 8 s |
| Dispach NLT · GPT-6.1 Sol | 118/125 (94%) | 89–97% | 0 | $0.81 | 1,490,867 | 86% | 12 s |
| Hermes · GPT-6.1 Sol | 120/125 (96%) | 91–98% | 0 | $0.53 | 2,729,115 | 98% | 11 s |
| OpenClaw · GPT-6.1 Sol | 95/125 (76%) | 68–83% | 0 | $1.73 | 6,216,179 | 94% | 25 s |
| Dispach native · GLM 5.3 | 117/125 (94%) | 88–97% | 1 | $0.92 | 1,682,956 | 94% | 13 s |
| Dispach NLT · GLM 5.3 | 103/125 (82%) | 75–88% | 1 | $1.04 | 1,392,695 | 87% | 10 s |
| Hermes · GLM 5.3 | 123/125 (98%) | 94–100% | 0 | $1.18 | 2,827,957 | 96% | 13 s |
| OpenClaw · GLM 5.3 | 98/125 (78%) | 70–85% | 7 | $4.86 | 8,690,426 | 91% | 35 s |

**Read plainly.** Accuracy did not move for any arm by more than the noise; the cost did. Dispach
native on Sol costs 63% less than at `309fdf8` ($1.84 → $0.69) with the same 120/125, and its cache hit
rate went from 57% to 87%; the first request of a run, which cached 15%, caches about 96%. Hermes is
still the cheapest on Sol ($0.53, 98% cached; Dispach is now 1.3× rather than 3.2×). On GLM Dispach
native is the cheapest per passed task ($0.78 per 100 passes against Hermes's $0.96). Dispach native
and Hermes are level on accuracy on both models; OpenClaw trails by about 18–20pp on both.

- *Dispach:* native on Sol loses only `recover-persist` (0/5, the repeat guard, as before). NLT on GLM
  still fails chains (13/25); NLT trails native on both models.
- *Hermes:* abstention on GLM went from 15/20 to 19/20 once runs stopped sharing memory, which is the
  contamination isolation was added for. It failed `recover-persist` on Sol (0/5) and passed 4/5 on GLM.
- *OpenClaw:* long files 0/15 on both models again; 7 GLM runs errored, its reasoning spending its
  4,096-token output cap as before.
- One run in each Dispach GLM arm hit the 300 s turn timeout and is scored 0.
- What remains between 87% and Hermes's 98% on Sol is new tool output inside a run and the reset of
  everything after the volatile tier when `memory_write` changes it.

## Head-to-head (`309fdf8`)

Same 25 tasks, n=5, the same proxy and tool server, all arms on 2026-10-21. OpenClaw 2026.10.5 and
Hermes 0.19.0 each run in their own container (`scripts/bench/images/`), set up with their own
documented commands, and restricted to the bench tools through their own controls, as the runtime's
arms run with `--system none`.

| Harness · model | Pass | 95% CI | Errored | Cost | Prompt tokens | Cached | Median run |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Dispach native · GPT-6.1 Sol | 120/125 (96%) | 91–98% | 0 | $1.84 | 1,552,763 | 57% | 7 s |
| Dispach NLT · GPT-6.1 Sol | 116/125 (93%) | 87–96% | 0 | $1.90 | 1,584,280 | 58% | 7 s |
| Hermes · GPT-6.1 Sol | 120/125 (96%) | 91–98% | 0 | $0.58 | 2,782,860 | 97% | 9 s |
| OpenClaw · GPT-6.1 Sol | 96/125 (77%) | 69–83% | 0 | $1.75 | 6,337,572 | 94% | 21 s |
| Dispach native · GLM 5.3 | 117/125 (94%) | 88–97% | 0 | $1.24 | 1,806,153 | 82% | 13 s |
| Dispach NLT · GLM 5.3 | 97/125 (78%) | 70–84% | 0 | $1.30 | 1,422,819 | 80% | 14 s |
| Hermes · GLM 5.3 | 120/125 (96%) | 91–98% | 1 | $1.63 | 3,025,942 | 92% | 11 s |
| OpenClaw · GLM 5.3 | 99/125 (79%) | 71–85% | 5 | $4.91 | 8,702,749 | 89% | 30 s |

**Read plainly.** Dispach native and Hermes are level on accuracy on both models (intervals overlap);
both are ahead of OpenClaw. Dispach's default dialect, NLT, loses to Hermes on GLM by 18pp with
non-overlapping intervals. On GPT-6.1 Sol Hermes does the same work for a third of the cost, because
97% of its prompt tokens are cache hits against Dispach's 57%; on GLM Dispach native is the cheapest.

**Where each loses**, from the replies:

- *OpenClaw:* long files 0/15 on both models (it truncates the tool output and says so); the clock
  task 0/5 on Sol, answered from the date in its own system prompt without calling the tool (right in
  real use, wrong against the bench's fixed clock); 5 GLM runs errored because its default
  `max_tokens: 4096` was consumed entirely by reasoning (4,093–4,096 reasoning tokens, no text).
- *Hermes:* abstention 15/20 on GLM; one GLM run hit the 300 s turn timeout.
- *Dispach:* `recover-persist` 0/5 in every arm. Hermes and OpenClaw pass it on GLM (recovery 25/25):
  they let a third identical write through, which `limits.noProgress.identicalCalls` refuses. NLT on
  GLM fails chains 11/25. One GLM run was an upstream Z.AI 520, scored as every arm's would be.

**Throttling.** OpenRouter's in-flight budget answered 402 with eight arms in parallel. The runner
now re-runs that like a 429 (`0cb5585`); the four affected arms were re-run whole with it, and the
originals are kept in `runs/h2h-309fdf8/superseded-402/` (OpenClaw on Sol had put its key on
cooldown after one 402 and refused 105 of 125 runs locally).

**What this does and does not show.** On these two models native is ahead of NLT by 21–31pp after
the fixes, with non-overlapping intervals. That narrows the published NLT result rather than
supporting it here. Known remaining failures:

- `recover-persist` fails in every Dispach arm. Its write fails twice, so passing takes a third
  identical call, and `limits.noProgress.identicalCalls` (default 3) refuses that call before it
  runs, so a looping write never happens three times. Harnesses without that guard pass it (see the
  head-to-head). The task is kept as it is rather than changed to pass.
- GPT-6 Luna under NLT sometimes reads the "Not enabled for you" list as covering the tools it was
  given, and says a pinned tool "isn't enabled".

## Reproducing

```bash
bun run build
bun --env-file=.env scripts/bench/run.ts --harness dispach-native --model glm-5.3 --repeats 5 \
    --out evals/harness/runs/<label>/native.glm-5.3.jsonl --log evals/harness/runs/<label>/native.glm-5.3.raw.jsonl
bun scripts/bench/report.ts evals/harness/runs/<label> --against evals/harness/runs/baseline-aae8fe4
```

Raw proxy logs (`*.raw.jsonl`, every request and the tail of every response) are not committed for
size (71 MB for the baseline alone).
