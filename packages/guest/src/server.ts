import { createServer, type Server } from "node:http"
import type { Guests } from "./guests.ts"
import { proxyModel, type Upstream } from "./proxy.ts"

export interface BrokerOptions {
    readonly guests: Guests
    readonly upstream: Upstream
}

export function createBroker(options: BrokerOptions): Server {
    return createServer((req, res) => {
        const path = new URL(req.url ?? "/", "http://broker").pathname
        if (req.method === "GET" && path === "/health") {
            res.writeHead(200, { "content-type": "application/json" })
            res.end(JSON.stringify({ status: "ok", guests: options.guests.all().length }))
            return
        }
        if (req.method === "POST" && path === "/model/chat/completions") {
            proxyModel(req, res, options.guests, options.upstream).catch((error: unknown) => {
                if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" })
                res.end(
                    JSON.stringify({ error: { message: String(error), code: "guest_internal" } }),
                )
            })
            return
        }
        res.writeHead(404, { "content-type": "application/json" })
        res.end(
            JSON.stringify({
                error: { message: `No route for ${req.method} ${path}.`, code: "not_found" },
            }),
        )
    })
}
