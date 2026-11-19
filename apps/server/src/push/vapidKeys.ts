import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { generateVapidKeyPair, isVapidKeyPair, type VapidKeyPair } from "./webPush.ts";

const VAPID_KEY_PAIR_SECRET = "web-push-vapid-key-pair";
const VAPID_KEY_PAIR_RESOURCE = "web push signing key pair";

const VapidKeyPairJson = Schema.fromJsonString(
  Schema.Struct({ publicKey: Schema.String, privateKey: Schema.String }),
);
const decodeVapidKeyPair = Schema.decodeUnknownEffect(VapidKeyPairJson);
const encodeVapidKeyPair = Schema.encodeEffect(VapidKeyPairJson);

const decodeError = (cause: unknown) =>
  new ServerSecretStore.SecretStoreDecodeError({ resource: VAPID_KEY_PAIR_RESOURCE, cause });

const readVapidKeyPair = Effect.fn("readVapidKeyPair")(function* (
  secrets: ServerSecretStore.ServerSecretStore["Service"],
) {
  const stored = yield* secrets.get(VAPID_KEY_PAIR_SECRET);
  if (Option.isNone(stored)) return Option.none<VapidKeyPair>();
  const keys = yield* decodeVapidKeyPair(new TextDecoder().decode(stored.value)).pipe(
    Effect.mapError(decodeError),
  );
  if (!isVapidKeyPair(keys)) return yield* decodeError("The stored key pair is malformed.");
  return Option.some<VapidKeyPair>(keys);
});

/**
 * The key pair that signs every push. It is made once and kept with the other secrets:
 * browsers subscribe against the public half, so a new pair would orphan every subscription.
 */
export const getOrCreateVapidKeyPair = Effect.fn("getOrCreateVapidKeyPair")(function* (
  secrets: ServerSecretStore.ServerSecretStore["Service"],
) {
  const existing = yield* readVapidKeyPair(secrets);
  if (Option.isSome(existing)) return existing.value;
  const created = generateVapidKeyPair();
  const encoded = yield* encodeVapidKeyPair(created).pipe(
    Effect.mapError(
      (cause) =>
        new ServerSecretStore.SecretStoreEncodeError({ resource: VAPID_KEY_PAIR_RESOURCE, cause }),
    ),
  );
  return yield* secrets.create(VAPID_KEY_PAIR_SECRET, new TextEncoder().encode(encoded)).pipe(
    Effect.as(created),
    // Another caller made the pair first; theirs is the one browsers will see.
    Effect.catchIf(ServerSecretStore.isSecretAlreadyExistsError, () =>
      readVapidKeyPair(secrets).pipe(
        Effect.flatMap(
          Option.match({
            onSome: Effect.succeed,
            onNone: () =>
              Effect.fail(
                new ServerSecretStore.SecretStoreConcurrentReadError({
                  resource: VAPID_KEY_PAIR_RESOURCE,
                }),
              ),
          }),
        ),
      ),
    ),
  );
});
