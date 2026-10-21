import { describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DockerPlacer } from "../src/placer.ts"

/** A `docker` that records its argv and succeeds, so the real `DockerPlacer` builds the real command. */
function stubDocker(): { bin: string; argv: () => string[] } {
    const dir = mkdtempSync(join(tmpdir(), "placer-"))
    const log = join(dir, "argv")
    const bin = join(dir, "docker")
    writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > "${log}"\n`)
    chmodSync(bin, 0o755)
    return { bin, argv: () => readFileSync(log, "utf8").trim().split("\n") }
}

describe("DockerPlacer containment", () => {
    test("an untrusted silo gets the runtime, the ceilings and no capabilities", async () => {
        const docker = stubDocker()
        const placer = new DockerPlacer({
            docker: docker.bin,
            network: "guests",
            contain: {
                runtime: "runsc",
                memory: "512m",
                cpus: "0.5",
                pids: 128,
                locked: true,
                restart: "no",
            },
        })
        await placer.create("guest-a", "token")
        const argv = docker.argv().join(" ")
        expect(argv).toContain("--runtime runsc")
        expect(argv).toContain("--memory 512m --memory-swap 512m")
        expect(argv).toContain("--cpus 0.5")
        expect(argv).toContain("--pids-limit 128")
        expect(argv).toContain("--cap-drop ALL --security-opt no-new-privileges")
        expect(argv).toContain("--restart no")
        // The token still travels by environment name, never by value on the command line.
        expect(argv).not.toContain("token")
    })

    test("without containment the command is what it always was", async () => {
        const docker = stubDocker()
        await new DockerPlacer({ docker: docker.bin, network: "silos" }).create("a", "token")
        const argv = docker.argv()
        expect(argv).toContain("unless-stopped")
        for (const flag of ["--runtime", "--memory", "--cpus", "--pids-limit", "--cap-drop"]) {
            expect(argv).not.toContain(flag)
        }
    })
})
