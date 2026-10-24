import { Analytics } from "@vercel/analytics/next"
import { RootProvider } from "fumadocs-ui/provider/next"
import "./global.css"
import type { Metadata } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import { brand } from "@/lib/shared"

const sans = Inter({ subsets: ["latin"], variable: "--font-sans" })
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" })

// Vercel sets this to the production domain, so the address is never written into the tree.
const host = process.env.VERCEL_PROJECT_PRODUCTION_URL

export const metadata: Metadata = {
    ...(host === undefined ? {} : { metadataBase: new URL(`https://${host}`) }),
    title: `${brand.name}: the agent backend your product calls over HTTP`,
    description: `${brand.name} is an open-source, self-hosted agent runtime: memory, tools, schedules, channels and approvals behind one HTTP API, on any OpenAI-compatible model.`,
}

export default function Layout({ children }: LayoutProps<"/">) {
    return (
        <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
            <body className="flex min-h-screen flex-col font-sans">
                {/* Terminal-native: dark unless the reader picks light. */}
                <RootProvider theme={{ defaultTheme: "dark" }}>{children}</RootProvider>
                {/* Page views for launch metrics. Cookieless; reports nothing until Web Analytics is enabled on the project. */}
                <Analytics />
            </body>
        </html>
    )
}
