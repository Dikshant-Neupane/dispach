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
    // Search indexes the OpenAPI document at request time, and the tracer cannot see a path built at
    // runtime, so without this the deployed function has no file to read and answers 500.
    outputFileTracingIncludes: { "/api/search": ["../developer-docs/reference/openapi.json"] },
    // `/docs` has no page of its own; the first section is where a reader starts.
    redirects: async () => [{ source: "/docs", destination: "/docs/runtime", permanent: false }],
}

export default withMDX(config)
