import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // One row per browser that turned on push notifications. The endpoint is the push
  // service URL the browser handed out, and the two keys encrypt messages to it. The
  // session is the signed-in device that subscribed; a revoked session gets no pushes.
  yield* sql`
    CREATE TABLE IF NOT EXISTS web_push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      session_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) WITHOUT ROWID
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_web_push_subscriptions_session
    ON web_push_subscriptions(session_id)
  `;
});
