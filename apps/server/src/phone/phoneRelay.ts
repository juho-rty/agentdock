/**
 * Pure pieces of phone access: which relay to use, how to start the quick
 * tunnel, and what cloudflared's output and the relay's answers mean.
 */

/** The AgentDock phone relay Worker (infra/phone-relay). */
export const DEFAULT_PHONE_RELAY_URL = "https://agentdock-phone.juho-agentdock.workers.dev";

/** Paths the relay Worker answers itself; see infra/phone-relay/src/relay.ts. */
export const PHONE_RELAY_REGISTER_PATH = "/__agentdock/register";

/** Name in the server secret store of this install's relay secret. */
export const PHONE_RELAY_SECRET_NAME = "phone-relay-secret";
export const PHONE_RELAY_SECRET_BYTES = 32;

/**
 * The relay origin from the setting, or null when it is not a bare https URL.
 * Empty means the built-in relay.
 */
export function resolvePhoneRelayUrl(setting: string): string | null {
  const value = setting.trim();
  if (value === "") return DEFAULT_PHONE_RELAY_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }
  return url.origin;
}

/**
 * cloudflared arguments for a quick tunnel to the local server. The tunnel
 * sends the relay's host as Host, so the server builds URLs, cookies and
 * origin checks for the address the phone actually opened.
 */
export function quickTunnelArgs(input: {
  readonly localOrigin: string;
  readonly relayUrl: string;
}): ReadonlyArray<string> {
  return [
    "tunnel",
    "--no-autoupdate",
    "--loglevel",
    "info",
    "--metrics",
    "127.0.0.1:0",
    "--url",
    input.localOrigin,
    "--http-host-header",
    new URL(input.relayUrl).host,
  ];
}

const QUICK_TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/iu;

/** The quick tunnel URL cloudflared prints once Cloudflare assigns one, if this line has it. */
export function parseQuickTunnelUrl(line: string): string | null {
  // cloudflared prints api.trycloudflare.com while it asks for a tunnel; that is not one.
  const match = QUICK_TUNNEL_URL.exec(line);
  if (!match) return null;
  const url = match[0].toLowerCase();
  return url === "https://api.trycloudflare.com" ? null : url;
}

/** cloudflared logs this once an edge connection serves the tunnel. */
export function isTunnelConnectionRegistered(line: string): boolean {
  return line.includes("Registered tunnel connection");
}

export type PhoneRelayRegistrationOutcome =
  | { readonly kind: "registered" }
  | { readonly kind: "claimed_elsewhere" }
  | { readonly kind: "rejected"; readonly reason: string }
  | { readonly kind: "retry"; readonly reason: string };

/** What a register response means for the server: keep, stop, or try again later. */
export function classifyRegistrationResponse(
  status: number,
  body: string,
): PhoneRelayRegistrationOutcome {
  if (status >= 200 && status < 300) return { kind: "registered" };
  if (status === 403) return { kind: "claimed_elsewhere" };
  let error = "";
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed !== null && typeof parsed === "object" && "error" in parsed) {
      error = String(parsed.error);
    }
  } catch {}
  const reason = error === "" ? `HTTP ${status}` : `${error} (HTTP ${status})`;
  // The Worker refuses a request it will never accept; anything else may pass on retry.
  return status === 400 || status === 401
    ? { kind: "rejected", reason }
    : { kind: "retry", reason };
}

/** URL-safe text for the bearer secret; the Worker accepts printable ASCII. */
export function encodePhoneRelaySecret(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
