// @effect-diagnostics nodeBuiltinImport:off -- lstat and positioned reads tail the native server log.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { OrchestrationV2ProviderFailure } from "@t3tools/contracts";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { antigravityManagedPath, antigravityProfileRoot } from "./AntigravityProfilePaths.ts";

const logSegments = ["antigravity-acp", "log"];
const SERVER_LOG = /^acp-server-[\w-]+\.log$/;
// The Go harness's own model-request retry, e.g.
// `run.go:308] Run: attempt 1 failed (transport error (Unavailable, HTTP 503): No capacity ...), retrying in 59.3s`.
const RETRY_LINE = /\brun\.go:\d+\] Run: attempt \d+ failed \((.*)\), retrying in \S+\s*$/;
const NO_CAPACITY = /No capacity available for model (\S+)/;
const STREAM_IDLE = /stream idle timeout \(([^)]+)\)/;
const NATIVE_SESSION_ID = /^[\w-]+$/;
// One poll never reads more than this from a log; a longer burst keeps only its tail.
const MAX_POLL_BYTES = 1_048_576;

function retryFailure(reason: string): OrchestrationV2ProviderFailure {
  const capacity = NO_CAPACITY.exec(reason);
  if (capacity !== null) {
    return makeProviderFailure({
      class: "provider_error",
      message: `Google has no capacity for ${capacity[1]} right now. Antigravity is retrying.`,
      code: "UNAVAILABLE",
      retryable: true,
    });
  }
  const idle = STREAM_IDLE.exec(reason);
  if (idle !== null) {
    return makeProviderFailure({
      class: "transport_error",
      message: `The model sent nothing for ${idle[1]}. Antigravity is retrying.`,
      retryable: true,
    });
  }
  return makeProviderFailure({ class: "provider_error", message: reason, retryable: true });
}

class AntigravityRetryLogError extends Schema.TaggedError<AntigravityRetryLogError>()(
  "AntigravityRetryLogError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read the Antigravity server log.";
  }
}

const retryLogError = (cause: unknown) => new AntigravityRetryLogError({ cause });

interface LogTail {
  offset: number;
  carry: string;
  /** This log named the session after the prompt was sent, so it is that session's process. */
  owned: boolean;
}

/**
 * Antigravity retries a failed model request on its own and says nothing over ACP until
 * one attempt answers, which can take longer than the prompt's inactivity limit. Its
 * server log records each retry. The returned poll reads what the logs gained since the
 * last poll and reports the newest retry of the process that took this session's prompt.
 */
export const watchAntigravityPromptRetries = Effect.fn("AntigravityRetryLog.watch")(function* (
  profileDirectory: string,
  sessionId: string,
) {
  const none = Effect.succeed<OrchestrationV2ProviderFailure | undefined>(undefined);
  if (!NATIVE_SESSION_ID.test(sessionId)) return none;
  const tails = new Map<string, LogTail>();

  const logFiles = async () => {
    const root = await antigravityProfileRoot(profileDirectory);
    if (root === undefined) return undefined;
    const directory = await antigravityManagedPath(root, logSegments, "directory");
    if (directory === undefined) return undefined;
    const names = await NodeFSP.readdir(directory.path).catch(() => []);
    return { directory: directory.path, names: names.filter((name) => SERVER_LOG.test(name)) };
  };

  const readAppended = async (file: string, tail: LogTail) => {
    const handle = await NodeFSP.open(
      file,
      NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW,
    );
    try {
      const info = await handle.stat();
      if (!info.isFile()) return "";
      if (info.size < tail.offset) {
        tail.offset = 0;
        tail.carry = "";
      }
      if (info.size === tail.offset) return "";
      const start = Math.max(tail.offset, info.size - MAX_POLL_BYTES);
      if (start !== tail.offset) tail.carry = "";
      const buffer = Buffer.alloc(info.size - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      tail.offset = start + bytesRead;
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  };

  // Only lines written after this point belong to the prompt about to be sent.
  yield* Effect.tryPromise({
    try: async () => {
      const logs = await logFiles();
      if (logs === undefined) return;
      for (const name of logs.names) {
        const info = await NodeFSP.lstat(NodePath.join(logs.directory, name)).catch(
          () => undefined,
        );
        if (info?.isFile()) tails.set(name, { offset: info.size, carry: "", owned: false });
      }
    },
    catch: retryLogError,
  }).pipe(Effect.ignore);

  return Effect.tryPromise({
    try: async () => {
      const logs = await logFiles();
      if (logs === undefined) return undefined;
      let latest: OrchestrationV2ProviderFailure | undefined;
      for (const name of logs.names) {
        let tail = tails.get(name);
        if (tail === undefined) {
          tail = { offset: 0, carry: "", owned: false };
          tails.set(name, tail);
        }
        const appended = await readAppended(NodePath.join(logs.directory, name), tail).catch(
          () => "",
        );
        if (appended.length === 0) continue;
        const lines = (tail.carry + appended).split("\n");
        tail.carry = lines.pop() ?? "";
        for (const line of lines) {
          if (!tail.owned && line.includes(sessionId)) tail.owned = true;
          if (!tail.owned) continue;
          const retry = RETRY_LINE.exec(line);
          if (retry !== null) latest = retryFailure(retry[1]!);
        }
      }
      return latest;
    },
    catch: retryLogError,
  }).pipe(Effect.orElseSucceed(() => undefined));
});
