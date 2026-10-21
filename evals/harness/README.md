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

`ac5dcc5` is decision 14.117: the fixes for what the `aae8fe4` baseline measured. Per-category
and per-task deltas are in `runs/after-ac5dcc5/results.json`.

**What this does and does not show.** On these two models native is ahead of NLT by 21–31pp after
the fixes, with non-overlapping intervals. That narrows the published NLT result rather than
supporting it here. Known remaining failures: the MCP error hint told the model never to retry,
even when the server said "try again", so `recover-retry` and `recover-persist` fail in every arm;
GPT-6 Luna under NLT often answers without calling a tool.

## Reproducing

```bash
bun run build
bun --env-file=.env scripts/bench/run.ts --harness dispach-native --model glm-5.3 --repeats 5 \
    --out evals/harness/runs/<label>/native.glm-5.3.jsonl --log evals/harness/runs/<label>/native.glm-5.3.raw.jsonl
bun scripts/bench/report.ts evals/harness/runs/<label> --against evals/harness/runs/baseline-aae8fe4
```

Raw proxy logs (`*.raw.jsonl`, every request and the tail of every response) are not committed for
size (71 MB for the baseline alone).
