# CLAUDE.md — packages/guest

The broker behind the website's guest terminal. **FSL-1.1-ALv2**, like `packages/control`, and under
the same rules: it imports nothing from this tree and declares no dependencies (`bun run check:deps`),
and its brand strings live in `src/brand.ts`. It drives the control plane over HTTP like any embedder.

1. **This process holds the only provider key, and nothing else does.** A silo's agent is given a
   guest token as its "API key" and this broker as its base URL; the proxy swaps the token for the real
   key on the way out. `exec` inside a silo can print everything in its environment, so the real key
   must never be in one. A test asserts the upstream never sees a guest token and a guest never sees
   the key.
2. **Every guest is disposable and bounded**: a token budget, a lifetime, an idle limit, and removal
   of the silo *and its volume* at the end. Nothing a guest does outlives the session.
3. **The proxy picks the model.** A guest cannot ask for a more expensive one by editing a request.
4. **Containment is the control plane's** (`DISPACH_CONTROL_CONTAIN_*`): gVisor, ceilings, no
   capabilities, a network whose only route out is this broker. This package never runs `docker run`.
