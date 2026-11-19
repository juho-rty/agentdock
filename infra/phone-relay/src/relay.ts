/**
 * Pure logic for the AgentDock phone relay Worker: control-path routing, the
 * registration secret check, tunnel origin validation, and the headers the
 * proxied request carries. `worker.ts` wires these to Cloudflare.
 */

/** Control paths live under one prefix the AgentDock server never serves. */
export const CONTROL_PREFIX = "/__agentdock/";
export const HEALTH_PATH = `${CONTROL_PREFIX}health`;
export const REGISTER_PATH = `${CONTROL_PREFIX}register`;
export const RESET_PATH = `${CONTROL_PREFIX}reset`;

/** Below this a secret is too easy to guess; the server generates 32 random bytes. */
const MIN_SECRET_LENGTH = 32;
const DEFAULT_ORIGIN_HOST_SUFFIX = ".trycloudflare.com";

export function readBearerToken(headers: Headers): string | null {
  const value = headers.get("authorization");
  if (!value) return null;
  const match = /^Bearer\s+(\S+)$/iu.exec(value.trim());
  return match ? match[1]! : null;
}

export function isAcceptableSecret(secret: string): boolean {
  return (
    secret.length >= MIN_SECRET_LENGTH && secret.length <= 512 && /^[\x21-\x7e]+$/u.test(secret)
  );
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Constant-time over equal-length inputs, which both sha256 hex digests are. */
export function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * Accepts only a bare `https://<name><suffix>` origin. The relay forwards
 * every request to it, so anything else (paths, credentials, other hosts)
 * would turn a leaked secret into an open proxy.
 */
export function parseTunnelOrigin(
  value: unknown,
  hostSuffix: string = DEFAULT_ORIGIN_HOST_SUFFIX,
): string | null {
  if (typeof value !== "string" || value.length > 300) return null;
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
    url.port !== "" ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const suffix = hostSuffix.toLowerCase();
  if (!host.endsWith(suffix) || host.length === suffix.length) return null;
  const label = host.slice(0, -suffix.length);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62})$/u.test(label)) return null;
  return url.origin;
}

export type RegistrationDecision =
  | { readonly kind: "claim" }
  | { readonly kind: "update" }
  | { readonly kind: "forbidden" };

/** Trust on first use: the first secret claims the relay; later ones must match it. */
export function decideRegistration(input: {
  readonly storedSecretHash: string | null;
  readonly presentedSecretHash: string;
}): RegistrationDecision {
  if (input.storedSecretHash === null) return { kind: "claim" };
  return timingSafeEqualHex(input.storedSecretHash, input.presentedSecretHash)
    ? { kind: "update" }
    : { kind: "forbidden" };
}

// Cloudflare adds its own copies on the way to the tunnel; stale client values must not survive.
const DROPPED_REQUEST_HEADERS = [
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "cf-worker",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
];

/**
 * Headers for the request to the tunnel. The server trusts only Host, which cloudflared
 * rewrites to the relay's host; the trycloudflare edge may overwrite the X-Forwarded-* ones.
 */
export function buildUpstreamHeaders(input: {
  readonly incoming: Headers;
  readonly publicHost: string;
  readonly clientIp: string | null;
}): Headers {
  const headers = new Headers(input.incoming);
  for (const name of DROPPED_REQUEST_HEADERS) headers.delete(name);
  headers.set("x-forwarded-host", input.publicHost);
  headers.set("x-forwarded-proto", "https");
  if (input.clientIp) headers.set("x-forwarded-for", input.clientIp);
  return headers;
}

export function buildUpstreamUrl(requestUrl: URL, origin: string): URL {
  return new URL(`${requestUrl.pathname}${requestUrl.search}`, origin);
}

/**
 * The tunnel answers 530 (Cloudflare error 1033) once its cloudflared is gone,
 * and 502 while it cannot reach the server. Either way the cached origin may be
 * stale, so the next request rereads the registration.
 */
export function isTunnelGoneStatus(status: number): boolean {
  return status === 530 || status === 502;
}

export function offlinePage(input: { readonly registered: boolean }): string {
  const detail = input.registered
    ? "The Mac running AgentDock is not reachable right now. Make sure AgentDock is open and Phone access is on, then reload."
    : "No AgentDock has registered with this relay yet. Turn on Phone access in AgentDock under Settings, Sharing &amp; access.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="15"><title>AgentDock offline</title><style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;min-height:100vh;place-items:center;padding:16px;box-sizing:border-box}main{max-width:28rem}h1{font-size:1.25rem}</style></head><body><main><h1>AgentDock is offline</h1><p>${detail}</p><p>This page retries every 15 seconds.</p></main></body></html>`;
}
