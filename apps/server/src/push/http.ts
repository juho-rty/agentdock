import { AuthOrchestrationReadScope, EnvironmentHttpApi } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  failEnvironmentInvalidRequest,
  requireEnvironmentScope,
} from "../auth/http.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as WebPushSubscriptions from "../persistence/WebPushSubscriptions.ts";
import { getOrCreateVapidKeyPair } from "./vapidKeys.ts";
import { isAllowedPushEndpoint, isValidSubscriptionKeys } from "./webPush.ts";

// Anyone who may read threads may be told about them; a push says no more than the thread list.
const SCOPE = AuthOrchestrationReadScope;

export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "webPush",
  Effect.fnUntraced(function* (handlers) {
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const subscriptions = yield* WebPushSubscriptions.WebPushSubscriptionsRepository;
    return handlers
      .handle(
        "vapidPublicKey",
        Effect.fn("environment.webPush.vapidPublicKey")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(SCOPE);
          const keys = yield* getOrCreateVapidKeyPair(secrets).pipe(
            Effect.catch((error) => failEnvironmentInternal("internal_error", error)),
          );
          return { publicKey: keys.publicKey };
        }),
      )
      .handle(
        "subscribe",
        Effect.fn("environment.webPush.subscribe")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          const session = yield* requireEnvironmentScope(SCOPE);
          const { endpoint, keys } = args.payload;
          if (!isAllowedPushEndpoint(endpoint) || !isValidSubscriptionKeys(keys)) {
            return yield* failEnvironmentInvalidRequest("invalid_command");
          }
          yield* subscriptions
            .upsert({
              endpoint,
              p256dh: keys.p256dh,
              auth: keys.auth,
              sessionId: session.sessionId,
              createdAt: DateTime.formatIso(yield* DateTime.now),
            })
            .pipe(Effect.catch((error) => failEnvironmentInternal("internal_error", error)));
        }),
      )
      .handle(
        "unsubscribe",
        Effect.fn("environment.webPush.unsubscribe")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(SCOPE);
          yield* subscriptions
            .remove(args.payload.endpoint)
            .pipe(Effect.catch((error) => failEnvironmentInternal("internal_error", error)));
        }),
      );
  }),
);
