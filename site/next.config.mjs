import { fileURLToPath } from "node:url"
import { createMDX } from "fumadocs-mdx/next"

const withMDX = createMDX()

/** The repo root: the docs, the OpenAPI spec, the evals feed and brand.ts all live above `site/`. */
const root = fileURLToPath(new URL("..", import.meta.url))

/** @type {import('next').NextConfig} */
const config = {
    reactStrictMode: true,
    turbopack: { root },
    outputFileTracingRoot: root,
    // `/docs` has no page of its own; the first section is where a reader starts.
    redirects: async () => [{ source: "/docs", destination: "/docs/runtime", permanent: false }],
}

export default withMDX(config)
