import { setTimeout as delay } from "node:timers/promises"

export function assertReleaseVersion(version) {
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
      version,
    )
  ) {
    throw new Error("Expected an exact release version, for example 0.4.0")
  }
}

// npm accepting a publication does not guarantee immediate registry visibility.
// Retry reads only; this helper never publishes or changes dist-tags.
export async function waitForPublishedVersion(
  version,
  {
    timeoutMs = 45 * 60_000,
    intervalMs = 15_000,
    requestTimeoutMs = 10_000,
    fetchMetadata = fetch,
    now = Date.now,
    sleep = delay,
    report = () => {},
  } = {},
) {
  assertReleaseVersion(version)
  const deadline = now() + timeoutMs
  let attempts = 0
  while (now() < deadline) {
    attempts++
    let response
    let metadata
    try {
      response = await fetchMetadata(
        `https://registry.npmjs.org/crispctl/${encodeURIComponent(version)}`,
        {
          signal: AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, deadline - now()))),
          headers: { accept: "application/json" },
          redirect: "error",
        },
      )
      if (response.ok) metadata = await response.json()
      else await response.body?.cancel()
    } catch {
      // Network failures, partial bodies and timeouts are transient. Do not echo
      // untrusted response bodies or fetch errors into release logs.
      response = undefined
    }
    if (metadata) {
      if (metadata.name !== "crispctl" || metadata.version !== version) {
        throw new Error("Registry returned unexpected package metadata")
      }
      report({ check: "registry-available", version, attempts })
      return metadata
    }
    if (
      response &&
      !response.ok &&
      response.status !== 404 &&
      response.status !== 429 &&
      response.status < 500
    ) {
      throw new Error(`Registry lookup failed with HTTP ${response.status}`)
    }
    report({
      check: "registry-pending",
      version,
      attempts,
      status: response?.status ?? "network_error",
    })
    const remaining = deadline - now()
    if (remaining > 0) await sleep(Math.min(intervalMs, remaining))
  }
  throw new Error(
    `crispctl@${version} is not available after the registry wait deadline. Publication may already be accepted; rerun verification without republishing.`,
  )
}
