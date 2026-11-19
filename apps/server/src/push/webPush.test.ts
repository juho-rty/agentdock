// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

import {
  base64UrlDecode,
  base64UrlEncode,
  buildWebPushRequest,
  deriveWebPushContentKeys,
  encryptWebPushPayload,
  generateVapidKeyPair,
  isAllowedPushEndpoint,
  isValidSubscriptionKeys,
  isVapidKeyPair,
  vapidAuthorization,
  WEB_PUSH_MAX_PLAINTEXT_BYTES,
  WebPushInputError,
} from "./webPush.ts";

/** A browser's side of a subscription: its key pair and auth secret. */
function makeReceiver() {
  const ecdh = NodeCrypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const authSecret = NodeCrypto.randomBytes(16);
  return {
    ecdh,
    authSecret,
    p256dh: base64UrlEncode(ecdh.getPublicKey()),
    auth: base64UrlEncode(authSecret),
  };
}

/** Decrypts an aes128gcm body the way a browser does (RFC 8188 and RFC 8291). */
function decrypt(receiver: ReturnType<typeof makeReceiver>, body: Uint8Array): string {
  const buffer = Buffer.from(body);
  const salt = buffer.subarray(0, 16);
  const recordSize = buffer.readUInt32BE(16);
  const keyIdLength = buffer.readUInt8(20);
  const senderPublicKey = buffer.subarray(21, 21 + keyIdLength);
  const record = buffer.subarray(21 + keyIdLength);
  expect(record.length).toBeLessThanOrEqual(recordSize);
  const { key, nonce } = deriveWebPushContentKeys({
    sharedSecret: receiver.ecdh.computeSecret(senderPublicKey),
    authSecret: receiver.authSecret,
    receiverPublicKey: receiver.ecdh.getPublicKey(),
    senderPublicKey,
    salt,
  });
  const decipher = NodeCrypto.createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const padded = Buffer.concat([
    decipher.update(record.subarray(0, record.length - 16)),
    decipher.final(),
  ]);
  const delimiter = padded.lastIndexOf(0x02);
  expect(delimiter).toBe(padded.length - 1);
  return padded.subarray(0, delimiter).toString("utf8");
}

describe("encryptWebPushPayload", () => {
  it("produces a body the subscribed browser can decrypt", () => {
    const receiver = makeReceiver();
    const message = JSON.stringify({ title: "Approval needed", body: "Fix the 로그인 flow" });
    const body = encryptWebPushPayload({
      plaintext: Buffer.from(message, "utf8"),
      p256dh: receiver.p256dh,
      auth: receiver.auth,
    });
    expect(decrypt(receiver, body)).toBe(message);
  });

  it("writes the aes128gcm header: salt, record size, then the sender's public key", () => {
    const receiver = makeReceiver();
    const sender = NodeCrypto.createECDH("prime256v1");
    sender.generateKeys();
    const salt = Buffer.alloc(16, 7);
    const body = Buffer.from(
      encryptWebPushPayload({
        plaintext: Buffer.from("hi"),
        p256dh: receiver.p256dh,
        auth: receiver.auth,
        salt,
        senderPrivateKey: sender.getPrivateKey(),
      }),
    );
    expect(body.subarray(0, 16).equals(salt)).toBe(true);
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(body.readUInt8(20)).toBe(65);
    expect(body.subarray(21, 86).equals(sender.getPublicKey())).toBe(true);
    // Two bytes of text, the delimiter, and the tag.
    expect(body.length).toBe(86 + 2 + 1 + 16);
  });

  it("uses a fresh salt and sender key for every message", () => {
    const receiver = makeReceiver();
    const input = { plaintext: Buffer.from("same"), p256dh: receiver.p256dh, auth: receiver.auth };
    const first = Buffer.from(encryptWebPushPayload(input));
    const second = Buffer.from(encryptWebPushPayload(input));
    expect(first.equals(second)).toBe(false);
    expect(decrypt(receiver, first)).toBe("same");
    expect(decrypt(receiver, second)).toBe("same");
  });

  it("cannot be decrypted with another auth secret", () => {
    const receiver = makeReceiver();
    const body = encryptWebPushPayload({
      plaintext: Buffer.from("secret"),
      p256dh: receiver.p256dh,
      auth: receiver.auth,
    });
    const stranger = { ...receiver, authSecret: NodeCrypto.randomBytes(16) };
    expect(() => decrypt(stranger, body)).toThrow();
  });

  it("refuses malformed keys and oversized messages", () => {
    const receiver = makeReceiver();
    expect(() =>
      encryptWebPushPayload({ plaintext: Buffer.from("x"), p256dh: "AAAA", auth: receiver.auth }),
    ).toThrow(WebPushInputError);
    expect(() =>
      encryptWebPushPayload({
        plaintext: Buffer.alloc(WEB_PUSH_MAX_PLAINTEXT_BYTES + 1),
        p256dh: receiver.p256dh,
        auth: receiver.auth,
      }),
    ).toThrow(WebPushInputError);
    const largest = encryptWebPushPayload({
      plaintext: Buffer.alloc(WEB_PUSH_MAX_PLAINTEXT_BYTES, 0x61),
      p256dh: receiver.p256dh,
      auth: receiver.auth,
    });
    expect(largest.length).toBe(4096);
  });
});

describe("vapidAuthorization", () => {
  it("signs an ES256 token the public key verifies", () => {
    const keys = generateVapidKeyPair();
    expect(isVapidKeyPair(keys)).toBe(true);
    const header = vapidAuthorization({
      endpoint: "https://web.push.apple.com/abc/def?x=1",
      keys,
      subject: "https://example.com",
      nowSeconds: 1_000,
    });
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/u.exec(header);
    expect(match).not.toBeNull();
    const [, encodedHeader, encodedClaims, signature, publicKey] = match!;
    expect(publicKey).toBe(keys.publicKey);
    expect(JSON.parse(base64UrlDecode(encodedHeader!).toString())).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
    expect(JSON.parse(base64UrlDecode(encodedClaims!).toString())).toEqual({
      aud: "https://web.push.apple.com",
      exp: 1_000 + 12 * 60 * 60,
      sub: "https://example.com",
    });
    const point = base64UrlDecode(keys.publicKey);
    const verifyKey = NodeCrypto.createPublicKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        x: base64UrlEncode(point.subarray(1, 33)),
        y: base64UrlEncode(point.subarray(33, 65)),
      },
    });
    const rawSignature = base64UrlDecode(signature!);
    expect(rawSignature.length).toBe(64);
    expect(
      NodeCrypto.verify(
        "sha256",
        Buffer.from(`${encodedHeader}.${encodedClaims}`),
        { key: verifyKey, dsaEncoding: "ieee-p1363" },
        rawSignature,
      ),
    ).toBe(true);
  });
});

describe("buildWebPushRequest", () => {
  it("sets the headers a push service needs and an encrypted body", () => {
    const receiver = makeReceiver();
    const request = buildWebPushRequest({
      subscription: {
        endpoint: "https://web.push.apple.com/token",
        p256dh: receiver.p256dh,
        auth: receiver.auth,
      },
      payload: '{"title":"Thread completed"}',
      vapid: generateVapidKeyPair(),
      subject: "https://example.com",
      nowSeconds: 5,
      ttlSeconds: 3600,
      topic: "0123456789abcdef",
    });
    expect(request.url).toBe("https://web.push.apple.com/token");
    expect(request.headers).toMatchObject({
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: "3600",
      urgency: "high",
      topic: "0123456789abcdef",
    });
    expect(request.headers.authorization).toMatch(/^vapid t=/u);
    expect(decrypt(receiver, request.body)).toBe('{"title":"Thread completed"}');
  });
});

describe("subscription checks", () => {
  it("accepts only https endpoints on known push services", () => {
    expect(isAllowedPushEndpoint("https://web.push.apple.com/QOx")).toBe(true);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/a")).toBe(
      true,
    );
    expect(isAllowedPushEndpoint("https://db5p.notify.windows.com/w/?token=a")).toBe(true);
    expect(isAllowedPushEndpoint("http://web.push.apple.com/QOx")).toBe(false);
    expect(isAllowedPushEndpoint("https://127.0.0.1/hook")).toBe(false);
    expect(isAllowedPushEndpoint("https://push.apple.com.evil.example/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://evilpush.apple.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://user@web.push.apple.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://web.push.apple.com:8443/x")).toBe(false);
    expect(isAllowedPushEndpoint("not a url")).toBe(false);
  });

  it("checks key sizes", () => {
    const receiver = makeReceiver();
    expect(isValidSubscriptionKeys(receiver)).toBe(true);
    expect(isValidSubscriptionKeys({ p256dh: receiver.p256dh, auth: "AAAA" })).toBe(false);
    expect(isValidSubscriptionKeys({ p256dh: "AAAA", auth: receiver.auth })).toBe(false);
  });
});
