import { loader } from "fumadocs-core/source"
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
        schema: ({ source }) =>
            pageSchema.extend({ title: z.string().default(firstHeading(source)) }),
    },
    meta: { schema: metaSchema },
})

export const source = loader(
    {
        docs: docs.toFumadocsSource(),
        openapi: await openapi.staticSource({ baseDir: "reference/http" }),
    },
    {
        baseUrl: docsRoute,
        // `README.md` is each folder's index.
        slugs: (_file, next) => {
            const slugs = next()
            return slugs.at(-1) === "README" ? slugs.slice(0, -1) : slugs
        },
        plugins: [openapi.loaderPlugin()],
    },
)
