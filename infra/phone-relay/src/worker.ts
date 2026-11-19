// A plain Worker with no Effect runtime: platform Date and fetch are the right tools here.
// @effect-diagnostics globalDate:off globalFetch:off
import { DurableObject } from "cloudflare:workers";

import {
  HEALTH_PATH,
  REGISTER_PATH,
  RESET_PATH,
  buildUpstreamHeaders,
  buildUpstreamUrl,
  decideRegistration,
  isAcceptableSecret,
  isTunnelGoneStatus,
  offlinePage,
  parseTunnelOrigin,
  readBearerToken,
  sha256Hex,
  timingSafeEqualHex,
} from "./relay.ts";

interface Env {
  readonly REGISTRY: DurableObjectNamespace<PhoneRelayRegistry>;
  /** Optional `wrangler secret`; lets the owner reset a relay whose install secret is lost. */
  readonly RESET_TOKEN?: string;
  readonly ORIGIN_HOST_SUFFIX?: string;
}

interface Registration {
  readonly origin: string | null;
  readonly updatedAt: string | null;
  readonly claimed: boolean;
}

type RegisterResult =
  | { readonly status: "claimed" | "updated"; readonly origin: string }
  | { readonly status: "forbidden" };

/**
 * One registry per relay: the install's secret hash and its current tunnel origin.
 * Bump the class name (with a migration) when its logic changes, since a deploy
 * does not restart a running object.
 */
export class PhoneRelayRegistry extends DurableObject<Env> {
  async read(): Promise<Registration> {
    const [origin, updatedAt, secretHash] = await Promise.all([
      this.ctx.storage.get<string>("origin"),
      this.ctx.storage.get<string>("updatedAt"),
      this.ctx.storage.get<string>("secretHash"),
    ]);
    return {
      origin: origin ?? null,
      updatedAt: updatedAt ?? null,
      claimed: secretHash !== undefined,
    };
  }

  async register(secretHash: string, origin: string): Promise<RegisterResult> {
    const stored = (await this.ctx.storage.get<string>("secretHash")) ?? null;
    const decision = decideRegistration({
      storedSecretHash: stored,
      presentedSecretHash: secretHash,
    });
    if (decision.kind === "forbidden") return { status: "forbidden" };
    await this.ctx.storage.put({
      secretHash,
      origin,
      updatedAt: new Date().toISOString(),
    });
    return { status: decision.kind === "claim" ? "claimed" : "updated", origin };
  }

  /** Clears the claim when the caller holds the install secret's hash or the reset token. */
  async reset(secretHash: string | null, resetTokenMatched: boolean): Promise<boolean> {
    if (!resetTokenMatched) {
      const stored = (await this.ctx.storage.get<string>("secretHash")) ?? null;
      if (stored === null || secretHash === null || !timingSafeEqualHex(stored, secretHash)) {
        return false;
      }
    }
    await this.ctx.storage.deleteAll();
    return true;
  }
}

const registryStub = (env: Env) => env.REGISTRY.get(env.REGISTRY.idFromName("default"));

// Per-isolate cache so proxied requests skip the Durable Object round trip.
const ORIGIN_CACHE_MS = 10_000;
let cachedRegistration: { readonly value: Registration; readonly expiresAt: number } | null = null;

async function currentRegistration(env: Env, fresh = false): Promise<Registration> {
  const now = Date.now();
  if (!fresh && cachedRegistration && cachedRegistration.expiresAt > now) {
    return cachedRegistration.value;
  }
  const value = await registryStub(env).read();
  cachedRegistration = { value, expiresAt: now + ORIGIN_CACHE_MS };
  return value;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const offline = (registered: boolean) =>
  new Response(offlinePage({ registered }), {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "15",
    },
  });

async function handleRegister(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = readBearerToken(request.headers);
  if (secret === null || !isAcceptableSecret(secret)) {
    return json({ error: "invalid_secret" }, 401);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const origin = parseTunnelOrigin(
    (body as { readonly origin?: unknown } | null)?.origin,
    env.ORIGIN_HOST_SUFFIX,
  );
  if (origin === null) return json({ error: "invalid_origin" }, 400);
  const result = await registryStub(env).register(await sha256Hex(secret), origin);
  if (result.status === "forbidden") return json({ error: "claimed_by_another_install" }, 403);
  cachedRegistration = null;
  return json({ status: result.status, origin: result.origin });
}

async function handleReset(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const presented = readBearerToken(request.headers);
  if (presented === null) return json({ error: "invalid_secret" }, 401);
  const resetTokenMatched =
    env.RESET_TOKEN !== undefined &&
    env.RESET_TOKEN.length > 0 &&
    timingSafeEqualHex(await sha256Hex(env.RESET_TOKEN), await sha256Hex(presented));
  const ok = await registryStub(env).reset(await sha256Hex(presented), resetTokenMatched);
  cachedRegistration = null;
  return ok ? json({ status: "reset" }) : json({ error: "forbidden" }, 403);
}

async function proxy(request: Request, env: Env, url: URL): Promise<Response> {
  const isUpgrade = request.headers.get("upgrade")?.toLowerCase() === "websocket";
  // Requests with a body can be sent only once, so only these retry against a refreshed origin.
  const retryable = isUpgrade || request.method === "GET" || request.method === "HEAD";
  const send = (origin: string) =>
    fetch(buildUpstreamUrl(url, origin), {
      method: request.method,
      headers: buildUpstreamHeaders({
        incoming: request.headers,
        publicHost: url.host,
        clientIp: request.headers.get("cf-connecting-ip"),
      }),
      body: request.body,
      redirect: "manual",
    });

  let registration = await currentRegistration(env);
  if (registration.origin === null) return offline(registration.claimed);
  let response: Response;
  try {
    response = await send(registration.origin);
  } catch {
    response = new Response(null, { status: 502 });
  }
  if (!isTunnelGoneStatus(response.status)) return response;

  const previousOrigin = registration.origin;
  registration = await currentRegistration(env, true);
  if (retryable && registration.origin !== null && registration.origin !== previousOrigin) {
    try {
      response = await send(registration.origin);
      if (!isTunnelGoneStatus(response.status)) return response;
    } catch {}
  }
  return isUpgrade ? new Response("AgentDock is offline", { status: 503 }) : offline(true);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case HEALTH_PATH: {
        const registration = await currentRegistration(env, true);
        return json({
          ok: true,
          claimed: registration.claimed,
          registered: registration.origin !== null,
          updatedAt: registration.updatedAt,
        });
      }
      case REGISTER_PATH:
        return handleRegister(request, env);
      case RESET_PATH:
        return handleReset(request, env);
      default:
        return proxy(request, env, url);
    }
  },
} satisfies ExportedHandler<Env>;
