# `@dispach/channel-whatsapp`

WhatsApp for a Dispach agent, through [Baileys](https://github.com/WhiskeySockets/Baileys).

> ## Read this before you pair a number
>
> **Baileys reverse-engineers WhatsApp Web. WhatsApp's terms do not permit it, and there is no
> appeal path when a number is banned** — including during development, and including for traffic
> that looks entirely ordinary. Nobody can tell you the odds, because WhatsApp does not publish
> them and changes them.
>
> **Pair a spare number.** Not a personal one, not a business one you rely on, not one that is
> somebody's two-factor recovery. That is the whole of the advice and it is not hedged.
>
> The channel is **bundled** with the `dispach` package and the container image, so the code ships
> to everybody — but nothing connects until a manifest names the channel. The opt-in is configuring
> it, for an account you chose.
> If you want WhatsApp with no such risk, the official Cloud API is a different integration behind
> the same `ChannelTransport` interface, and it is not this.

## Configuring it

No install step and no `plugins:` entry. In `agent.yaml`:

```yaml
channels:
  - type: whatsapp
    id: wa
    authDir: ./.whatsapp              # the paired session. Gitignore it.
    pairWith: "8801711223344"         # the account the agent runs as. Omit it to pair by QR.
    allowFrom: ["8801711223344"]      # digits, no +. Inbound only, and closed by default.
```

`init --whatsapp connected --whatsapp-number <digits>` writes this block for you.

## Pairing

With `pairWith` set, pairing is an eight-character code typed into the phone under **Linked
devices** → **Link with phone number**. The channel reports `needs_input` with a `pairing_code`
payload, and `dispach channels pair <agent> wa` starts a host if none is up, shows the code and
waits.

`pairWith` is the account the agent *runs as*; `allowFrom` is who may message it, and the paired
account is always admitted.

Without `pairWith`, the channel reports `needs_input` with a QR:

```bash
dispach serve <agent>
#   wa: needs_input — scan to pair channel "wa" (qr, expires 2026-09-22T12:01:00Z
#       — GET /v1/agents/<id> carries it)
```

The payload is the raw QR string, not a picture — a terminal wants an ASCII block and a browser
wants an `<img>`, so the runtime carries the bytes and each surface renders them. The browser's
channels panel draws it for you. Open WhatsApp → **Linked devices** → **Link a device** and scan.

WhatsApp rotates the code roughly every twenty seconds; each one replaces the last, and a stale one
is shown as stale rather than as broken.

### `allowFrom` takes digits

`8801711223344`. No `+`, no spaces, no dashes — the entry is compared literally against the digits
WhatsApp reports, so `+8801711223344` matches **nobody** and produces a channel that connects
perfectly and refuses the one person it was set up for. If you get it wrong, the first refused
message prints the exact line to paste.

## What it does and does not do

| | |
| --- | --- |
| Text in and out | yes, including captions on an image or a document |
| Groups | **no** — a group has its own addressing and `allowFrom` is per sender; out of scope rather than half-supported |
| Media out | images, and audio (including voice notes as `ptt`) |
| Read receipts, presence | `composing` while a turn runs; nothing else |
| Message ids | reported, but `idempotentSend` is **false** — WhatsApp does not promise to deduplicate a re-sent id, and claiming otherwise would turn the outbox's visible `uncertain` flag into a silent duplicate |

### The session directory

`authDir` holds credentials that **are** the linked device — anyone with them is your WhatsApp.
Every file is written `0600` and the directory `0700`, re-applied each time Baileys writes a new
signal key rather than once at creation. Gitignore it. Deleting it unpairs the agent and the next
start issues a fresh QR.

If WhatsApp revokes the session — you unlinked it from the phone, or they did — the channel deletes
the directory itself and pairs again. Keeping revoked credentials is worse than having none: every
reconnect fails and no QR is ever issued, which is a channel that is running and cannot be fixed
without finding the directory by hand.

## Building it

```bash
bun run build     # one self-contained ES module, Baileys inlined
```

Nothing is installed at runtime (hard rule 5), so the published artefact is one file with its
dependencies bundled in — which is what makes the same directory work in a checkout, in the
npm install and in the container. Three of Baileys' optional media dependencies stay external
(`sharp`, `jimp`, `link-preview-js`); Baileys loads each inside a `catch`,
so their absence costs image thumbnails and link previews and nothing else.

Apache-2.0. Baileys is MIT and is its own project.
