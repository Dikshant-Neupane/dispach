# Releasing

Maintainers cut releases. Contributors should add user-visible changes to the `Unreleased` section of `CHANGELOG.md` when requested during review.

The release preparation script refuses a dirty tree, a version that is not newer than the current one, and an empty `Unreleased` section. It then updates the versioned files, dates the changelog section, regenerates the HTTP API reference (`developer-docs/reference/openapi.json` carries the version), runs the release gate (`build`, `test`, `typecheck`, `lint`, `docs:check`, `verify:package`), and prints the commit and tag commands:

```bash
bun run release 0.2.1
```

It does not commit, tag, push, or publish. A pushed `v*` tag triggers the release workflow, which publishes the npm package, GitHub release, container image, and stable Homebrew formula.

A pre-release, such as a pilot ahead of the next release, uses a hyphenated version newer than the current one:

```bash
bun run release 0.2.1-pilot.1
```

A pre-release tag creates a GitHub pre-release, publishes npm under `next`, and pushes only the exact
container tag. It does not move npm `latest`, the container `latest` tag, or the Homebrew formula.
The control plane itself remains source-distributed from `packages/control`; the published npm
package is the runtime and CLI.

Before preparing a release:

1. Complete the checks in [Testing and evaluations](testing-and-evaluations.md).
2. Run the manual pass in `docs/13-QA.md`.
3. Confirm the changelog describes user-visible behavior and migration needs.
4. Verify generated documentation and the package tarball.

The complete operational procedure and recovery notes are in `RELEASING.md`.
