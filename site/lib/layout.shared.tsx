import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared"
import { brand, repoUrl } from "./shared"

export function baseOptions(): BaseLayoutProps {
    return {
        nav: { title: brand.name },
        links: [
            { text: "Docs", url: "/docs" },
            { text: "Evals", url: "/evals" },
        ],
        githubUrl: repoUrl,
    }
}
