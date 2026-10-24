#!/usr/bin/env bun
/**
 * Check the developer docs the site publishes: every top-level directory under `developer-docs/` is a
 * section with a `README.md` and a `SUMMARY.md`, every page is in its summary, every local link and
 * anchor resolves, and the site's own section lists name exactly these directories.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, extname, join, relative, resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "..")
const DOCS = join(ROOT, "developer-docs")
const failures: string[] = []

const sections = readdirSync(DOCS)
    .filter((name) => statSync(join(DOCS, name)).isDirectory())
    .sort()
const directories = sections.map((name) => join(DOCS, name))
for (const name of sections) {
    if (!existsSync(join(DOCS, name, "README.md")))
        failures.push(`developer-docs/${name} has no README.md`)
}

// The site names its sections twice, as literals its build needs: the sidebar order in `tree.ts` and
// the page globs in `source.ts`. A directory missing from either is a section the site never shows.
const named = (file: string, pattern: RegExp): string[] =>
    [...readFileSync(join(ROOT, file), "utf8").matchAll(pattern)]
        .map((match) => match[1] ?? "")
        .sort()
const sidebar = named("site/lib/tree.ts", /"([\w-]+)"(?=[^\n]*\] as const)/g)
for (const [file, listed] of [
    ["site/lib/tree.ts", sidebar],
    ["site/lib/source.ts", named("site/lib/source.ts", /"([\w-]+)\/\*\*\/\*\.md"/g)],
] as const) {
    if (listed.join(",") !== sections.join(","))
        failures.push(
            `${file} lists sections ${listed.join(", ")}; developer-docs has ${sections.join(", ")}`,
        )
}

const markdownFiles = (directory: string): string[] => {
    const found: string[] = []
    const walk = (current: string): void => {
        for (const name of readdirSync(current)) {
            const path = join(current, name)
            if (statSync(path).isDirectory()) walk(path)
            else if (extname(path) === ".md") found.push(path)
        }
    }
    walk(directory)
    return found
}

const slug = (heading: string): string =>
    heading
        .toLowerCase()
        .replace(/`([^`]*)`/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
        .trim()
        .replace(/\s+/g, "-")

const headings = new Map<string, Set<string>>()
const links = new Map<string, string[]>()
const allPages = directories.flatMap(markdownFiles)
for (const file of allPages) {
    const text = readFileSync(file, "utf8")
    headings.set(
        file,
        new Set(
            [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => slug(match[1]?.trim() ?? "")),
        ),
    )
    links.set(
        file,
        [...text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]?.trim() ?? ""),
    )
}

const navigated = new Set<string>()
for (const [source, targets] of links) {
    for (const raw of targets) {
        if (raw === "" || /^(?:https?:|mailto:)/.test(raw)) continue
        const [encodedPath, anchor] = raw.split("#", 2)
        const localPath = decodeURIComponent(encodedPath ?? "")
        let target = localPath === "" ? source : resolve(dirname(source), localPath)
        if (existsSync(target) && statSync(target).isDirectory()) target = join(target, "README.md")
        if (!existsSync(target)) {
            failures.push(`${relative(ROOT, source)} links to missing ${raw}`)
            continue
        }
        if (extname(target) === ".md") {
            if (source.endsWith("SUMMARY.md")) navigated.add(target)
            if (anchor !== undefined && anchor !== "" && !headings.get(target)?.has(anchor)) {
                failures.push(`${relative(ROOT, source)} links to missing heading ${raw}`)
            }
        }
    }
}

for (const directory of directories) {
    const summary = join(directory, "SUMMARY.md")
    if (!existsSync(summary)) failures.push(`${relative(ROOT, directory)} has no SUMMARY.md`)
}
for (const page of allPages) {
    if (page.endsWith("SUMMARY.md")) continue
    if (!navigated.has(page)) failures.push(`${relative(ROOT, page)} is absent from its SUMMARY.md`)
}

if (failures.length > 0) {
    process.stderr.write(
        `developer documentation failed ${failures.length} check(s):\n${failures
            .map((failure) => `  - ${failure}`)
            .join("\n")}\n`,
    )
    process.exit(1)
}

process.stdout.write(
    `developer documentation: ${sections.length} sections, ${allPages.length} Markdown files\n`,
)
