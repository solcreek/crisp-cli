export const SDK_WEBSITE_TIER_CONNECT_PATH = "/v1/website/connect/endpoints"

export const PLUGIN_CONNECT_PATH = "/v1/plugin/connect/endpoints"

export function connectEndpointsPath(tier: "website" | "plugin", websiteId: string): string {
  if (tier === "plugin") {
    return PLUGIN_CONNECT_PATH
  }
  return `/v1/website/${encodeURIComponent(websiteId)}/connect/endpoints`
}

export function listenStubMessage(websiteId?: string): string {
  const correct = websiteId
    ? connectEndpointsPath("website", websiteId)
    : "/v1/website/{website_id}/connect/endpoints"
  return [
    "listen is not implemented (RTM is a follow-up).",
    "",
    "Website-tier pitfall: the official crisp-api Node SDK requests",
    `GET ${SDK_WEBSITE_TIER_CONNECT_PATH}`,
    "when the token tier is \"website\". That call omits website_id and does not work.",
    `The correct website route is GET ${correct}.`,
    `Plugin tier uses GET ${PLUGIN_CONNECT_PATH}, which the SDK does call.`,
    "",
    "Use the Cos Sandbox website only. Never point listen at production Teachify.",
  ].join("\n")
}
