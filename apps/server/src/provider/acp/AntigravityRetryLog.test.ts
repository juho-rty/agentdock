import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { watchAntigravityPromptRetries } from "./AntigravityRetryLog.ts";

const SESSION = "7a11f703-a419-4a4f-8901-4fbd408ae417";
// Lines from Antigravity 1.4.5's acp-server log while Google had no capacity for the model.
const SENT = `I1125 16:06:59.718149     298 server.go:1883] Sending user message to conversation ${SESSION} (items=2, media=0)\n`;
const NO_CAPACITY =
  "I1125 16:07:00.739689     494 run.go:308] Run: attempt 1 failed (transport error (Unavailable, HTTP 503): No capacity available for model gemini-4-carbon-high on the server: UNAVAILABLE (code 503): No capacity available for model gemini-4-carbon-high on the server), retrying in 59.339202023s\n";
const STREAM_IDLE =
  "I1125 16:18:00.187330     494 run.go:308] Run: attempt 2 failed (request failed: stream idle timeout (10m0s): context deadline exceeded), retrying in 7.348641026s\n";

describe("watchAntigravityPromptRetries", () => {
  it.effect("reports only this prompt's own retries, once each", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const profileDirectory = yield* fs.makeTempDirectoryScoped();
      const logs = path.join(profileDirectory, "antigravity-acp", "log");
      yield* fs.makeDirectory(logs, { recursive: true });
      const own = path.join(logs, "acp-server-20261125_160657-92030.log");
      const other = path.join(logs, "acp-server-20261125_160634-91620.log");
      const append = (file: string, text: string) => fs.writeFileString(file, text, { flag: "a" });
      // An earlier prompt's retry is already in the log when this prompt starts.
      yield* append(own, SENT + NO_CAPACITY);
      yield* append(other, "I1125 16:06:34.000000      39 server.go:1] started\n");

      const poll = yield* watchAntigravityPromptRetries(profileDirectory, SESSION);
      assert.isUndefined(yield* poll);

      // Another session's process retries; that is not this prompt's news.
      yield* append(other, NO_CAPACITY);
      assert.isUndefined(yield* poll);

      yield* append(own, SENT + NO_CAPACITY.slice(0, 40));
      assert.isUndefined(yield* poll);
      yield* append(own, NO_CAPACITY.slice(40));
      const capacity = yield* poll;
      assert.equal(
        capacity?.message,
        "Google has no capacity for gemini-4-carbon-high right now. Antigravity is retrying.",
      );
      assert.equal(capacity?.retryable, true);
      assert.isUndefined(yield* poll);

      yield* append(own, STREAM_IDLE);
      assert.equal(
        (yield* poll)?.message,
        "The model sent nothing for 10m0s. Antigravity is retrying.",
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("stays quiet without a log directory", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const profileDirectory = yield* fs.makeTempDirectoryScoped();
      const poll = yield* watchAntigravityPromptRetries(profileDirectory, SESSION);
      assert.isUndefined(yield* poll);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
