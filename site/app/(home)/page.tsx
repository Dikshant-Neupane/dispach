import Link from "next/link"
import { brand } from "@/lib/shared"

// Placeholder until the landing page is designed.
export default function HomePage() {
    return (
        <main className="flex flex-1 flex-col justify-center px-4 text-center">
            <h1 className="mb-4 text-2xl font-bold">{brand.name}</h1>
            <p>
                <Link href="/docs" className="font-medium underline">
                    Docs
                </Link>{" "}
                ·{" "}
                <Link href="/evals" className="font-medium underline">
                    Evals
                </Link>
            </p>
        </main>
    )
}
