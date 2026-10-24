import { DocsBody, DocsPage } from "fumadocs-ui/layouts/docs/page"
import { createRelativeLink } from "fumadocs-ui/mdx"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { OpenAPIPage } from "@/components/api-page"
import { getMDXComponents } from "@/components/mdx"
import { brand } from "@/lib/shared"
import { source } from "@/lib/source"

/**
 * Fumadocs resolves only `./` and `../` links, and the docs are written with bare `page.md` links. A bare path is made explicit rather than rewriting every page.
 */
const explicit = (href: string | undefined) =>
    href !== undefined && /^[\w-][^:]*\.md(#.*)?$/.test(href) ? `./${href}` : href

export default async function Page(props: PageProps<"/docs/[[...slug]]">) {
    const params = await props.params
    const page = source.getPage(params.slug)
    if (!page) notFound()

    if (page.type === "openapi") {
        return (
            <DocsPage full>
                <DocsBody>
                    <OpenAPIPage {...page.data.getOpenAPIPageProps()} />
                </DocsBody>
            </DocsPage>
        )
    }

    // The Markdown carries its own H1, so the page renders no separate title.
    const MDX = page.data.body
    const RelativeLink = createRelativeLink(source, page)
    return (
        <DocsPage toc={page.data.toc}>
            <DocsBody>
                <MDX
                    components={getMDXComponents({
                        a: ({ href, ...rest }) => <RelativeLink href={explicit(href)} {...rest} />,
                    })}
                />
            </DocsBody>
        </DocsPage>
    )
}

export function generateStaticParams() {
    return source.generateParams()
}

export async function generateMetadata(props: PageProps<"/docs/[[...slug]]">): Promise<Metadata> {
    const params = await props.params
    const page = source.getPage(params.slug)
    if (!page) notFound()
    return { title: `${page.data.title} · ${brand.name}`, description: page.data.description }
}
