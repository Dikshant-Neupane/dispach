# Stable and pre-releases

Dispach publishes stable runtime releases and pre-releases. Pin an exact version whenever
you deploy a server or silo.

| Release line | Intended use | Distribution |
| --- | --- | --- |
| `v0.2.x` stable | The current runtime | npm `latest`, GitHub Release, versioned and `latest` container tags, Homebrew |
| `v0.x.y-pilot.N` | Evaluating work ahead of the next release | npm `next`, GitHub pre-release, exact-version container tag |

Check [GitHub Releases](https://github.com/moeen-mahmud/dispach/releases) for the latest version
before installing.

## Install the line you intend to test

Install the stable CLI through the default npm tag:

```bash
npm install --global dispach@latest
```

Install a pre-release by exact version:

```bash
npm install --global dispach@<version>
docker pull ghcr.io/moeen-mahmud/dispach:<version>
```

A pre-release does not update the npm `latest` tag, the `latest` container tag, or the stable
Homebrew formula. Do not use `next` as a production pin: it moves whenever a new pre-release is
published.

## The control plane

One isolated runtime silo per product user or team is managed through the
[control plane](../control-plane/README.md): placement, proxy routing, key minting, suspension,
backup, restore, recreation, aggregate usage, and monitoring.

`packages/control` remains a private, source-distributed package under FSL-1.1-ALv2. It is not
included in the published `dispach` npm package. Run it from a matching repository checkout and pin
the silo image to the same version.

Pre-release APIs can change between revisions. Review the notes for each one and the `Unreleased`
section of `CHANGELOG.md` before upgrading. In 0.2.0 the multiplayer surfaces (rooms, stand-ins,
team memory, peer ask) are experimental: on the HTTP API only, and they may change within 0.2.x.
