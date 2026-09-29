import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MockAgent, type Dispatcher } from "undici"

export const FIXTURE = {
  identifier: "11111111-1111-1111-1111-111111111111",
  key: "fixture-token-key-do-not-log",
  tier: "plugin",
  websiteId: "8c842203-7ed8-4e29-a608-7cf78a7d2fcc",
  session: "session_700c65e1-85e2-465a-b9ac-ecb5ec2c9881",
  userId: "a4c32c68-be91-4e29-8a05-976e93abbe3f",
}

export function credentialEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const home = mkdtempSync(join(tmpdir(), "crispctl-"))
  const env: NodeJS.ProcessEnv = {
    HOME: home,
    CRISP_IDENTIFIER: FIXTURE.identifier,
    CRISP_KEY: FIXTURE.key,
    CRISP_WEBSITE_ID: FIXTURE.websiteId,
    CRISP_TIER: FIXTURE.tier,
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) {
      delete env[key]
    } else {
      env[key] = value
    }
  }
  return env
}

export function removeHome(env: NodeJS.ProcessEnv): void {
  if (env.HOME) {
    rmSync(env.HOME, { recursive: true, force: true })
  }
}

export function buffers(): {
  stdout: (chunk: string) => void
  stderr: (chunk: string) => void
  out: () => string
  err: () => string
} {
  const outChunks: string[] = []
  const errChunks: string[] = []
  return {
    stdout: (chunk) => {
      outChunks.push(chunk)
    },
    stderr: (chunk) => {
      errChunks.push(chunk)
    },
    out: () => outChunks.join(""),
    err: () => errChunks.join(""),
  }
}

export type Captured = {
  method: string
  path: string
  body: unknown
  headers: Record<string, string>
}

type MockOpts = {
  path?: string
  method?: string
  headers?: unknown
  body?: unknown
}

export type MockResponse = {
  status: number
  json: object | string
  headers?: Record<string, string>
}

export async function withCrispMock(
  response: MockResponse | MockResponse[],
  fn: (dispatcher: Dispatcher) => Promise<void>,
): Promise<Captured[]> {
  const responses = Array.isArray(response) ? response : [response]
  const agent = new MockAgent()
  agent.disableNetConnect()
  const pool = agent.get("https://api.crisp.chat")
  const calls: Captured[] = []
  for (const method of ["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD"]) {
    pool.intercept({ path: () => true, method }).reply((opts: MockOpts) => {
      const current = responses[Math.min(calls.length, responses.length - 1)] ?? responses[0]
      calls.push({
        method: String(opts.method ?? method),
        path: String(opts.path ?? ""),
        body: decodeBody(opts.body),
        headers: headerMap(opts.headers),
      })
      return {
        statusCode: current?.status ?? 500,
        data: current?.json ?? {},
        responseOptions: {
          headers: {
            "content-type": "application/json",
            ...(current?.headers ?? {}),
          },
        },
      }
    }).persist()
  }
  try {
    await fn(agent)
    return calls
  } finally {
    await agent.close()
  }
}

export function okEnvelope(data: unknown): { error: false; reason: string; data: unknown } {
  return { error: false, reason: "ok", data }
}

export function basicAuth(identifier = FIXTURE.identifier, key = FIXTURE.key): string {
  return `Basic ${Buffer.from(`${identifier}:${key}`).toString("base64")}`
}

export function assertUrl(actual: string, expected: string): void {
  const base = "https://api.crisp.chat"
  const actualUrl = new URL(actual.startsWith("http") ? actual : `${base}${actual}`)
  const expectedUrl = new URL(expected.startsWith("http") ? expected : `${base}${expected}`)
  if (actualUrl.pathname !== expectedUrl.pathname) {
    throw new Error(`pathname ${actualUrl.pathname} !== ${expectedUrl.pathname} (raw ${actual})`)
  }
  const actualQuery = [...actualUrl.searchParams.entries()]
  const expectedQuery = [...expectedUrl.searchParams.entries()]
  if (JSON.stringify(actualQuery) !== JSON.stringify(expectedQuery)) {
    throw new Error(`query ${JSON.stringify(actualQuery)} !== ${JSON.stringify(expectedQuery)} (raw ${actual})`)
  }
}

function decodeBody(body: unknown): unknown {
  if (body === undefined || body === null || body === "") return null
  const text = typeof body === "string"
    ? body
    : Buffer.isBuffer(body)
      ? body.toString("utf8")
      : String(body)
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function headerMap(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  if (typeof headers === "object" && headers && typeof (headers as { get?: unknown }).get === "function") {
    const iterable = headers as { forEach: (fn: (value: string, key: string) => void) => void }
    iterable.forEach((value, key) => {
      out[key.toLowerCase()] = value
    })
    return out
  }
  if (Array.isArray(headers)) {
    for (let i = 0; i < headers.length; i += 2) {
      out[String(headers[i]).toLowerCase()] = String(headers[i + 1])
    }
    return out
  }
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      out[key.toLowerCase()] = value.map(String).join(", ")
    } else if (value !== undefined && value !== null) {
      out[key.toLowerCase()] = String(value)
    }
  }
  return out
}
