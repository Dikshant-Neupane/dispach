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
- **Scoring:** an errored run scores 0 and stays in the denominator. A run lost to a 429 is re-run
  and counted as a retry; none occurred in these runs. Intervals are Wilson 95%.

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
