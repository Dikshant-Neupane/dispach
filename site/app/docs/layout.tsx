import { DocsLayout } from "fumadocs-ui/layouts/docs"
import { baseOptions } from "@/lib/layout.shared"
import { tree } from "@/lib/tree"

export default function Layout({ children }: LayoutProps<"/docs">) {
    return (
        <DocsLayout tree={tree} {...baseOptions()}>
            {children}
        </DocsLayout>
    )
}
