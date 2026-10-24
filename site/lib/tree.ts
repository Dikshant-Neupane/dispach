import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Folder, Item, Node, Root } from "fumadocs-core/page-tree"
import { source } from "./source"

/**
 * One tab per section, in this order. Titles come from each SUMMARY.md. `docs:check` fails when this
 * list and the directories under `developer-docs/` disagree.
 */
const SECTIONS = ["runtime", "contributing", "control-plane", "reference"] as const
const DOCS = join(process.cwd(), "..", "developer-docs")

const byPath = new Map(source.getPages().map((page) => [page.path, page]))

function item(section: string, href: string, name: string): Item {
    const page = byPath.get(`${section}/${href}`)
    // A SUMMARY.md naming a page that did not load is a broken build, not a missing sidebar row.
    if (page === undefined)
        throw new Error(`${section}/SUMMARY.md links ${href}, which is not a loaded page`)
    return { type: "page", name, url: page.url }
}

/**
 * `SUMMARY.md` stays the navigation source (check-docs already verifies it): `- [Title](path.md)` is a
 * page, a bare `- Title` is a group, and two spaces of indent nest one level.
 */
function section(dir: string): Folder {
    const text = readFileSync(join(DOCS, dir, "SUMMARY.md"), "utf8")
    const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? dir
    // Every folder needs an $id: the tab switcher matches roots by id, and undefined === undefined matches all of them.
    const folder: Folder = { $id: dir, type: "folder", name: title, root: true, children: [] }
    const stack: { depth: number; children: Node[] }[] = [{ depth: -1, children: folder.children }]

    for (const line of text.split("\n")) {
        const match = line.match(/^( *)- (?:\[(.+?)\]\((.+?)\)|(.+))$/)
        if (match === null) continue
        const depth = (match[1]?.length ?? 0) / 2
        while ((stack.at(-1)?.depth ?? -1) >= depth) stack.pop()
        const parent = stack.at(-1)?.children ?? folder.children
        const [, , name, href, group] = match
        if (href !== undefined && name !== undefined) {
            const node = item(dir, href, name)
            if (href === "README.md" && depth === 0) folder.index = node
            else parent.push(node)
        } else if (group !== undefined) {
            const sub: Folder = {
                $id: `${dir}/${group.trim()}`,
                type: "folder",
                name: group.trim(),
                children: [],
            }
            parent.push(sub)
            stack.push({ depth, children: sub.children })
        }
    }
    return folder
}

function httpApi(): Folder {
    const pages = source.getPages().filter((page) => page.type === "openapi")
    return {
        $id: "reference/http",
        type: "folder",
        name: "HTTP API",
        defaultOpen: true,
        // A summary is a sentence; `GET /v1/agents` is what a reader scans a sidebar for.
        children: pages.map((page) => {
            const op = page.data.getOpenAPIPageProps().operations?.[0]
            const name =
                op === undefined ? page.data.title : `${op.method.toUpperCase()} ${op.path}`
            return { type: "page", name, url: page.url }
        }),
    }
}

export const tree: Root = {
    $id: "docs",
    name: "Docs",
    children: SECTIONS.map((dir) => {
        const folder = section(dir)
        if (dir === "reference") folder.children.push(httpApi())
        return folder
    }),
}
