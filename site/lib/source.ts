import { type LoaderOutput, loader, type Page } from "fumadocs-core/source"
import { metaSchema, pageSchema } from "fumadocs-core/source/schema"
import { defineDocs } from "fumadocs-mdx/macro"
import { z } from "zod"
import { openapi } from "./openapi"
import { docsRoute } from "./shared"

/** The docs are plain Markdown with an H1 title, so the title comes from the body, not frontmatter. */
function firstHeading(source: string): string {
    return source.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "Untitled"
}

const docs = defineDocs({
    dir: "../developer-docs",
    docs: {
        files: [
            "runtime/**/*.md",
            "contributing/**/*.md",
            "control-plane/**/*.md",
            "reference/**/*.md",
            "!**/SUMMARY.md",
        ],
        schema: ({ source }) => {
            // @ts-expect-error TypeScript 7 exceeds its inference depth on Zod's object extension.
            return pageSchema.extend({ title: z.string().default(firstHeading(source)) })
        },
    },
    meta: { schema: metaSchema },
})

const sources = {
    docs: docs.toFumadocsSource(),
    openapi: await openapi.staticSource({ baseDir: "reference/http" }),
} as const

const loaded = loader<typeof sources>(sources, {
    baseUrl: docsRoute,
    // `README.md` is each folder's index.
    slugs: (_file, next) => {
        const slugs = next()
        return slugs.at(-1) === "README" ? slugs.slice(0, -1) : slugs
    },
    plugins: [openapi.loaderPlugin()],
})

// TypeScript 7 widens macro-generated page data through loader(); preserve its emitted MDX fields.
export const source = loaded as LoaderOutput<{
    page:
        | Page<"docs", (typeof docs.docs)[number]>
        | Extract<(typeof loaded)["$inferPage"], { type: "openapi" }>
    meta: (typeof loaded)["$inferMeta"]
    i18n: undefined
}>
