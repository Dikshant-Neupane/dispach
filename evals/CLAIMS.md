# Claim register

Every number Dispach says in public, with the evidence behind it. A claim that is not here, or
is not `verified`, does not go in a README, a docs page, a release note or a post.

Statuses: **verified** (a committed file in this repo carries the number), **cite** (external
research, linked; not reproduced here), **needs-run** (true as far as we know, no committed
result yet), **fix** (the prose and the evidence disagree), **remove** (no evidence found).

## Tool dialect (NLT vs native)

| Claim | Evidence | Scope | Limitation | Status |
| --- | --- | --- | --- | --- |
| NLT ahead of native: qwen3.5:9b 94.6% vs 91.9%, deepseek-chat 97.3% vs 86.5%, deepseek-reasoner 91.9% vs 89.2% | `evals/tools/results.json`, `evals/tools/qwen-3pass/results.json` (2026-08-14) | 37 fixtures, one model call each, routing + argument coercion, temperature 0 | No tool is executed. The qwen margin is **one fixture**. qwen NLT has a 2.7% critical rate against native's 0.0% | verified |
| NLT uses 21–23% fewer prompt tokens | `evals/tools/results.json` | Same run | Prompt tokens only, not total cost | verified |
| +14.9pp accuracy, 93% fewer critical errors, −25% tokens; +24 to +43pp on small models | Somma, Plante & Premji, 2026 replication of Johnson et al. 2025, [arXiv 2607.03953](https://arxiv.org/abs/2607.03953), 14 models, 8,560 trials | External | Preprint. Frontier models (GPT-5, Gemini 2.5 Pro) show smaller or reversed gains. Our own eval cannot test the critical-error claim | cite |
| Decision 4.1's local deltas: +13.5pp deepseek-chat, +5.4pp deepseek-reasoner | No committed file; the current results say +10.8 and +2.7 | — | Overwritten by a later run with reasoning suppressed | fix |

## Phase-scoped tools

| Claim | Evidence | Scope | Limitation | Status |
| --- | --- | --- | --- | --- |
| Constraining tools per phase took local models from 2/10 to 10/10 | None found in the repo or in a search | — | Quoted in decision 4.5 as motivation | remove (or cite) |
| On deepseek-v4-pro, phase scoping **cost** 8.3–12.5pp | `evals/phases/results.json` | 24 of 37 tasks, 1 repeat, two runs | Frontier model only; the small-model arm has never been run. Run-to-run noise was 4.2pp | verified (negative) |

## Boot and runtime

| Claim | Evidence | Scope | Limitation | Status |
| --- | --- | --- | --- | --- |
| Boot to `runtime.ready` under 1000 ms, CI fails at 1200 ms | `scripts/bench-boot.ts:18`, `.github/workflows/ci.yml` | Every CI run | Boot, not response latency | verified |
| Boot measured at ~87 ms (0.2.0; ~53 ms at 0.1.3) | README prose; `bench:boot` run 2026-10-20 | 7-run median, Apple M4 Pro, load average 5–8 | No committed result yet | needs-run → `evals/boot/` |
| Container image 867 MB | `docker image inspect`, 2026-10-20 | arm64 Docker Desktop, 0.2.0 release candidate | 701 MB at 0.1.3; the static `ffmpeg` layer is 104 MB. Reported by CI on every push, no longer gated | verified |
| `Runtime.create` 27 ms; remote provider refresh 1,474 ms | Decision 4.21 prose only | — | No committed result | needs-run |
| The runtime Dispach replaced spends ~4 minutes on network calls during hook initialisation | None committed | OpenClaw gateway on our deployment | Needs the log evidence, or drop the number | needs-run (evidence) |
| Idle silo: 104 / 120 / 178 MiB RSS and 118 / 151 / 516 ms cold start for 1 / 10 / 100 agents; resume 5–6 ms | `evals/tenancy/results.json` (2026-09-24) | linux/arm64 image, Node 24 | One machine | verified |

## Prompting, context and memory

| Claim | Evidence | Scope | Limitation | Status |
| --- | --- | --- | --- | --- |
| One emphatic framing line lifts qwen3.5:9b all-rules compliance by 20pp; deepseek-chat unchanged | `evals/prompt-style/results-intensity-6rules.json` | 6 rules, 20 tasks | p≈0.16; the whole lift comes from one rule (`digits`) | verified |
| Example placement (system vs user) makes no difference | `evals/prompt-style/results.json` | Same | Saturated at 100% in both arms: "no difference at this difficulty", nothing more | verified |
| Rule compliance: deepseek-v4-pro saturated at 64/64 | `evals/rules/README.md` | 1–6 rules | Saturated | verified |
| Rule compliance on a small model "not yet recorded" | `evals/rules/README.md` says so; `evals/rules/results.json` holds a qwen3.5:9b run at 0.990, usable | — | The README and its own results disagree | fix |
| Token-estimate correction: mean error 14.2% uncalibrated, 2.9% with the shipped EMA | `evals/budget/results.json` | deepseek-v4-pro, 31 turns | One endpoint | verified |
| A model writing a shell script into `exec` damages 25% of multi-line arguments, half silently | `evals/nlt-heredoc/results.json` (2026-09-13) | deepseek-chat, 8 tasks × 2 | A floor on the problem, one endpoint; the backstop false-repairs about a third | verified |
| Memory retrieval latency | `evals/memory/` has no results | — | — | needs-run |
| Skill-index scan 5.1 ms cold / 0.6 ms warm | README prose only | bun/macOS, node/linux | No committed result | needs-run |

## Safety and agents

| Claim | Evidence | Scope | Limitation | Status |
| --- | --- | --- | --- | --- |
| Prompt injection via a fetched page: 0 of 6 cases executed | `evals/web/*/results.json` (2026-08-15) | deepseek-v4-pro (NLT and native), deepseek-v4-flash | Measures the **model**: the write gate never fired. The gate is proven by `trust.test.ts`, not by this eval. No small model was run | verified |
| Agent scenarios: 4 of 4 pass | `evals/scenarios/example/results.json` (2026-09-27) | deepseek-v4-pro judged by deepseek-v4-flash | Only 2 runs | verified |
| Delegation cuts the parent's prompt by 31.6% | Fixture-only run, no `results.json` | — | Never run against a real endpoint; total tokens went **up** | needs-run |
| Routing bulk tool work to a subagent pays for itself | `evals/subagents/` (pilot line) | — | Check that a committed result exists before quoting | needs-run |

## Reproducing

Every `verified` row names its file. The command that produced it is in that directory's
`README.md`. A claim whose evidence changes gets its row updated in the same commit.
