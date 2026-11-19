import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import { PersistenceDecodeError, PersistenceSqlError } from "./Errors.ts";

export type WebPushSubscriptionsRepositoryError = PersistenceSqlError | PersistenceDecodeError;

const SubscriptionRow = Schema.Struct({
  endpoint: Schema.String,
  p256dh: Schema.String,
  auth: Schema.String,
});
export type WebPushSubscriptionRow = typeof SubscriptionRow.Type;

/** The browsers that asked for push notifications, each tied to the session that subscribed. */
export class WebPushSubscriptionsRepository extends Context.Service<
  WebPushSubscriptionsRepository,
  {
    /** Saves a subscription; the same endpoint again moves it to the new session and keys. */
    readonly upsert: (input: {
      readonly endpoint: string;
      readonly p256dh: string;
      readonly auth: string;
      readonly sessionId: string;
      /** When the browser subscribed, as an ISO instant. */
      readonly createdAt: string;
    }) => Effect.Effect<void, WebPushSubscriptionsRepositoryError>;
    readonly remove: (endpoint: string) => Effect.Effect<void, WebPushSubscriptionsRepositoryError>;
    /** Subscriptions whose session is neither revoked nor expired at `now`, an ISO instant. */
    readonly listDeliverable: (
      now: string,
    ) => Effect.Effect<ReadonlyArray<WebPushSubscriptionRow>, WebPushSubscriptionsRepositoryError>;
  }
>()("t3/persistence/WebPushSubscriptions/WebPushSubscriptionsRepository") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listDeliverableRows = SqlSchema.findAll({
    Request: Schema.String,
    Result: SubscriptionRow,
    execute: (now) =>
      sql`
        SELECT s.endpoint AS "endpoint", s.p256dh AS "p256dh", s.auth AS "auth"
        FROM web_push_subscriptions s
        JOIN auth_sessions a ON a.session_id = s.session_id
        WHERE a.revoked_at IS NULL
          AND a.expires_at > ${now}
        ORDER BY s.created_at, s.endpoint
      `,
  });

  return WebPushSubscriptionsRepository.of({
    upsert: Effect.fn("WebPushSubscriptionsRepository.upsert")(
      function* (input) {
        yield* sql`
          INSERT INTO web_push_subscriptions (endpoint, p256dh, auth, session_id, created_at)
          VALUES (${input.endpoint}, ${input.p256dh}, ${input.auth}, ${input.sessionId}, ${input.createdAt})
          ON CONFLICT (endpoint)
          DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, session_id = excluded.session_id
        `;
      },
      Effect.mapError(
        (cause) => new PersistenceSqlError({ operation: "upsertWebPushSubscription", cause }),
      ),
    ),
    remove: Effect.fn("WebPushSubscriptionsRepository.remove")(
      function* (endpoint) {
        yield* sql`DELETE FROM web_push_subscriptions WHERE endpoint = ${endpoint}`;
      },
      Effect.mapError(
        (cause) => new PersistenceSqlError({ operation: "removeWebPushSubscription", cause }),
      ),
    ),
    listDeliverable: Effect.fn("WebPushSubscriptionsRepository.listDeliverable")(
      function* (now) {
        return yield* listDeliverableRows(now);
      },
      Effect.mapError((cause): WebPushSubscriptionsRepositoryError =>
        Schema.isSchemaError(cause)
          ? PersistenceDecodeError.fromSchemaError("WebPushSubscription", cause)
          : new PersistenceSqlError({ operation: "listWebPushSubscriptions", cause }),
      ),
    ),
  });
});

export const layer = Layer.effect(WebPushSubscriptionsRepository, make);
