import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { fetch } from "undici"
import { CrispClient, CRISP_ORIGIN } from "../../src/client.js"
import { assertComplete, resolveCredentials } from "../../src/config.js"
import { CrispApiError } from "../../src/errors.js"
import { readResponseText, decodeResponse } from "../../src/response.js"
import { listen } from "../../src/rtm.js"
import { assertConversationPages } from "../conversation-pages-assertions.js"

const enabled =
  (process.env.CRISPCTL_LIVE === "1" || process.env.CRISP_LIVE === "1") &&
  process.env.CRISPCTL_LIVE_WRITE === "1"

test(
  "sandbox live writes, RTM delivery, error envelopes and cleanup",
  {
    skip: enabled
      ? false
      : "requires REST live opt-in and CRISPCTL_LIVE_WRITE=1 (dedicated sandbox only)",
    timeout: 180_000,
  },
  async () => {
    const expectedName = process.env.CRISPCTL_LIVE_WEBSITE_NAME
    assert.ok(expectedName, "explicit sandbox website name is required")
    const creds = resolveCredentials(process.env, {})
    assertComplete(creds)
    const site = `/website/${encodeURIComponent(creds.websiteId)}`
    // The client intentionally has no create/delete command. This harness uses
    // those endpoints only to create and remove its own synthetic conversation.
    async function request(method: string, path: string, body?: unknown): Promise<unknown> {
      const signal = AbortSignal.timeout(20_000)
      const response = await fetch(new URL(`/v1${path}`, CRISP_ORIGIN), {
        method,
        signal,
        redirect: "error",
        headers: {
          Authorization: `Basic ${Buffer.from(`${creds.identifier}:${creds.key}`).toString("base64")}`,
          "X-Crisp-Tier": creds.tier,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return decodeResponse(await readResponseText(response, signal), response.status)
    }
    const website = (await request("GET", site)) as { name?: unknown }
    assert.ok(website?.name === expectedName, "sandbox identity must match before any write")
    const client = new CrispClient(creds)
    const readOnly = new CrispClient(creds, undefined, true)
    const created = (await request("POST", `${site}/conversation`)) as { session_id?: unknown }
    assert.equal(typeof created?.session_id, "string", "created session identifier must be present")
    const session = created.session_id as string
    const path = `${site}/conversation/${encodeURIComponent(session)}`
    const controller = new AbortController()
    let listening: Promise<void> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const content = `crispctl synthetic live test ${randomUUID()}`
      let authenticate!: () => void
      const authenticated = new Promise<void>((resolve) => {
        authenticate = resolve
      })
      let matched = false
      timeout = setTimeout(() => controller.abort(), 60_000)
      listening = listen(readOnly, creds, {
        signal: controller.signal,
        events: ["message:received"],
        session,
        count: 1,
        onStatus: (status) => {
          if (status.status === "authenticated") authenticate()
        },
        onEvent: (event) => {
          const data = event.data as {
            content?: unknown
            website_id?: unknown
            session_id?: unknown
          }
          matched =
            data.content === content &&
            data.website_id === creds.websiteId &&
            data.session_id === session
        },
      })
      // Also reject if discovery/authentication stops before the handshake.
      await Promise.race([
        authenticated,
        listening.then(() => {
          throw new Error("RTM stopped before authentication")
        }),
      ])
      await client.sendOperatorMessage(session, "note", content)
      await listening
      assert.ok(matched, "RTM must deliver the synthetic note for the expected website and session")
      const messages = await readOnly.listMessages(session)
      assert.ok(
        Array.isArray(messages) && messages.some((message) => message.content === content),
        "synthetic note must be readable",
      )
      for (const state of ["resolved", "unresolved"] as const) {
        await client.setState(session, state)
        const current = (await request("GET", `${path}/state`)) as { state?: unknown }
        assert.ok(current?.state === state, "written state must be readable")
      }
      await client.setSegments(session, ["crispctl-synthetic-test"])
      await client.assign(session, null)
      await client.markRead(session)
      assertConversationPages(await readOnly.listConversationPages(session))
      await assert.rejects(readOnly.sendOperatorMessage(session, "note", "must not be sent"), {
        name: "UsageError",
      })
      await assert.rejects(
        request("PATCH", `${path}/state`, { state: "invalid-fixture-state" }),
        (error) =>
          error instanceof CrispApiError && error.status === 400 && error.reason === "invalid_data",
      )
      await assert.rejects(
        readOnly.getConversation(`session_${randomUUID()}`),
        (error) =>
          error instanceof CrispApiError &&
          error.status === 404 &&
          error.reason === "conversation_not_found",
      )
    } finally {
      controller.abort()
      clearTimeout(timeout)
      try {
        await listening
      } finally {
        await request("DELETE", path)
      }
    }
    await assert.rejects(
      readOnly.getConversation(session),
      (error) => error instanceof CrispApiError && error.status === 404,
    )
  },
)
