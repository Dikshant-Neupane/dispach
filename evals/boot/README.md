# Boot: process start to `runtime.ready`

```bash
bun run bench:boot -- --write
```

Seven fresh child processes, each booting `examples/minimal` to `runtime.ready` with placeholder
credentials. Nothing is dialled, which is part of what the benchmark proves: no network I/O before
readiness. `results.json` carries the median, the split between interpreter-plus-imports and
`Runtime.create`, the per-phase medians, and the commit and machine it was taken on.

The budget is 1000 ms and CI fails above 1200 ms. Boot is not response latency: a turn's time is
the model's, and this measures only how fast the runtime is ready to start one.
