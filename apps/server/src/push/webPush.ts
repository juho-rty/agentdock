// @effect-diagnostics nodeBuiltinImport:off
/**
 * Web Push without a dependency: message encryption (RFC 8291, aes128gcm from RFC 8188)
 * and the VAPID authorization header (RFC 8292). Everything here is pure, so the caller
 * supplies the clock.
 */
import * as NodeCrypto from "node:crypto";

import * as Schema from "effect/Schema";

const CURVE = "prime256v1";
const PUBLIC_KEY_BYTES = 65;
const AUTH_SECRET_BYTES = 16;
const SALT_BYTES = 16;
const RECORD_SIZE = 4096;
const TAG_BYTES = 16;
/** salt, record size, key id length, then the sender's public key. */
const HEADER_BYTES = SALT_BYTES + 4 + 1 + PUBLIC_KEY_BYTES;
/** The largest plaintext that still fits one record with its padding delimiter and tag. */
export const WEB_PUSH_MAX_PLAINTEXT_BYTES = RECORD_SIZE - HEADER_BYTES - TAG_BYTES - 1;

/** Both halves base64url: the uncompressed P-256 point and the raw 32 byte scalar. */
export interface VapidKeyPair {
  readonly publicKey: string;
  readonly privateKey: string;
}

export interface WebPushSubscriptionKeys {
  readonly endpoint: string;
  /** The browser's P-256 public key, base64url. */
  readonly p256dh: string;
  /** The browser's 16 byte auth secret, base64url. */
  readonly auth: string;
}

export interface WebPushRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export class WebPushInputError extends Schema.TaggedError<WebPushInputError>()(
  "WebPushInputError",
  { message: Schema.String },
) {}
export const isWebPushInputError = Schema.is(WebPushInputError);

export const base64UrlEncode = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("base64url");

export const base64UrlDecode = (value: string): Buffer => Buffer.from(value, "base64url");

// Push services Apple, Google, Mozilla and Microsoft run. The server posts to whatever a
// signed-in browser registered, so anything else is refused rather than fetched.
const PUSH_SERVICE_HOSTS = [
  "push.apple.com",
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
] as const;

/** Whether a subscription endpoint is an https URL on a known push service. */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return false;
  if (url.port !== "" && url.port !== "443") return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** Whether the keys a browser sent have the sizes RFC 8291 requires. */
export function isValidSubscriptionKeys(keys: Omit<WebPushSubscriptionKeys, "endpoint">): boolean {
  const publicKey = base64UrlDecode(keys.p256dh);
  return (
    publicKey.length === PUBLIC_KEY_BYTES &&
    publicKey[0] === 0x04 &&
    base64UrlDecode(keys.auth).length === AUTH_SECRET_BYTES
  );
}

export function generateVapidKeyPair(): VapidKeyPair {
  const ecdh = NodeCrypto.createECDH(CURVE);
  ecdh.generateKeys();
  return {
    publicKey: base64UrlEncode(ecdh.getPublicKey()),
    privateKey: base64UrlEncode(ecdh.getPrivateKey()),
  };
}

export function isVapidKeyPair(keys: VapidKeyPair): boolean {
  const publicKey = base64UrlDecode(keys.publicKey);
  return (
    publicKey.length === PUBLIC_KEY_BYTES &&
    publicKey[0] === 0x04 &&
    base64UrlDecode(keys.privateKey).length === 32
  );
}

function vapidSigningKey(keys: VapidKeyPair): NodeCrypto.KeyObject {
  const publicKey = base64UrlDecode(keys.publicKey);
  return NodeCrypto.createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      d: keys.privateKey,
      x: base64UrlEncode(publicKey.subarray(1, 33)),
      y: base64UrlEncode(publicKey.subarray(33, 65)),
    },
  });
}

const VAPID_TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;

/**
 * The `Authorization` value for one push service: an ES256 JWT whose audience is the
 * endpoint's origin, plus the public key the browser subscribed with.
 */
export function vapidAuthorization(input: {
  readonly endpoint: string;
  readonly keys: VapidKeyPair;
  /** A `mailto:` or `https:` contact; Apple rejects a token without a usable one. */
  readonly subject: string;
  readonly nowSeconds: number;
}): string {
  const encode = (value: unknown) => base64UrlEncode(Buffer.from(JSON.stringify(value)));
  const unsigned = `${encode({ typ: "JWT", alg: "ES256" })}.${encode({
    aud: new URL(input.endpoint).origin,
    exp: Math.floor(input.nowSeconds) + VAPID_TOKEN_LIFETIME_SECONDS,
    sub: input.subject,
  })}`;
  const signature = NodeCrypto.sign("sha256", Buffer.from(unsigned), {
    key: vapidSigningKey(input.keys),
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${unsigned}.${base64UrlEncode(signature)}, k=${input.keys.publicKey}`;
}

const hkdf = (ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Buffer =>
  Buffer.from(NodeCrypto.hkdfSync("sha256", ikm, salt, info, length));

/** The content encryption key and nonce both sides derive (RFC 8291 section 3.4). */
export function deriveWebPushContentKeys(input: {
  readonly sharedSecret: Uint8Array;
  readonly authSecret: Uint8Array;
  readonly receiverPublicKey: Uint8Array;
  readonly senderPublicKey: Uint8Array;
  readonly salt: Uint8Array;
}): { readonly key: Buffer; readonly nonce: Buffer } {
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    input.receiverPublicKey,
    input.senderPublicKey,
  ]);
  const ikm = hkdf(input.sharedSecret, input.authSecret, keyInfo, 32);
  return {
    key: hkdf(ikm, input.salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
    nonce: hkdf(ikm, input.salt, Buffer.from("Content-Encoding: nonce\0"), 12),
  };
}

/**
 * Encrypts one message as a single aes128gcm record. The salt and sender key are fresh
 * per message; tests pass their own to get a fixed result.
 */
export function encryptWebPushPayload(input: {
  readonly plaintext: Uint8Array;
  readonly p256dh: string;
  readonly auth: string;
  readonly salt?: Uint8Array;
  readonly senderPrivateKey?: Uint8Array;
}): Uint8Array {
  const receiverPublicKey = base64UrlDecode(input.p256dh);
  const authSecret = base64UrlDecode(input.auth);
  if (!isValidSubscriptionKeys(input)) {
    throw new WebPushInputError({ message: "The push subscription keys are malformed." });
  }
  if (input.plaintext.length > WEB_PUSH_MAX_PLAINTEXT_BYTES) {
    throw new WebPushInputError({ message: "The push message is too large for one record." });
  }
  const sender = NodeCrypto.createECDH(CURVE);
  if (input.senderPrivateKey === undefined) sender.generateKeys();
  else sender.setPrivateKey(input.senderPrivateKey);
  const senderPublicKey = sender.getPublicKey();
  const salt = input.salt ?? NodeCrypto.randomBytes(SALT_BYTES);
  const { key, nonce } = deriveWebPushContentKeys({
    sharedSecret: sender.computeSecret(receiverPublicKey),
    authSecret,
    receiverPublicKey,
    senderPublicKey,
    salt,
  });
  const cipher = NodeCrypto.createCipheriv("aes-128-gcm", key, nonce);
  // 0x02 marks the last record; no further padding follows it.
  const ciphertext = Buffer.concat([
    cipher.update(input.plaintext),
    cipher.update(Buffer.from([0x02])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(HEADER_BYTES);
  Buffer.from(salt).copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, SALT_BYTES);
  header.writeUInt8(PUBLIC_KEY_BYTES, SALT_BYTES + 4);
  senderPublicKey.copy(header, SALT_BYTES + 5);
  return Buffer.concat([header, ciphertext]);
}

/** Everything one delivery needs; the caller only has to POST it. */
export function buildWebPushRequest(input: {
  readonly subscription: WebPushSubscriptionKeys;
  readonly payload: string;
  readonly vapid: VapidKeyPair;
  readonly subject: string;
  readonly nowSeconds: number;
  /** How long the push service keeps the message for an offline device. */
  readonly ttlSeconds: number;
  /** A newer message with the same topic replaces an undelivered older one. */
  readonly topic?: string;
}): WebPushRequest {
  const body = encryptWebPushPayload({
    plaintext: Buffer.from(input.payload, "utf8"),
    p256dh: input.subscription.p256dh,
    auth: input.subscription.auth,
  });
  return {
    url: input.subscription.endpoint,
    headers: {
      authorization: vapidAuthorization({
        endpoint: input.subscription.endpoint,
        keys: input.vapid,
        subject: input.subject,
        nowSeconds: input.nowSeconds,
      }),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(input.ttlSeconds),
      urgency: "high",
      ...(input.topic === undefined ? {} : { topic: input.topic }),
    },
    body,
  };
}
