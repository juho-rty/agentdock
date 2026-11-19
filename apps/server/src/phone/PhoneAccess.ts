/**
 * Phone access through Cloudflare: while the setting is on, runs a cloudflared
 * quick tunnel to this server and registers its URL with the phone relay
 * Worker, whose stable workers.dev URL phones open. See infra/phone-relay.
 */
import type { PhoneAccessState, PhoneAccessStatus } from "@t3tools/contracts";
import * as RelayClient from "@t3tools/shared/relayClient";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest } from "effect/http";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ManagedLimits from "../policy/managedLimits.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as Settings from "../serverSettings.ts";
import {
  DEFAULT_PHONE_RELAY_URL,
  PHONE_RELAY_REGISTER_PATH,
  PHONE_RELAY_SECRET_BYTES,
  PHONE_RELAY_SECRET_NAME,
  classifyRegistrationResponse,
  encodePhoneRelaySecret,
  isTunnelConnectionRegistered,
  parseQuickTunnelUrl,
  quickTunnelArgs,
  resolvePhoneRelayUrl,
} from "./phoneRelay.ts";

class PhoneAccessError extends Schema.TaggedError<PhoneAccessError>()("PhoneAccessError", {
  message: Schema.String,
}) {}

export class PhoneAccess extends Context.Service<
  PhoneAccess,
  {
    readonly getStatus: Effect.Effect<PhoneAccessStatus>;
    readonly setStatus: (status: PhoneAccessStatus) => Effect.Effect<void>;
  }
>()("t3/phone/PhoneAccess") {}

const OFF_STATUS: PhoneAccessStatus = {
  enabled: false,
  state: "off",
  relayUrl: DEFAULT_PHONE_RELAY_URL,
  tunnelUrl: null,
  error: null,
};

export const layer = Layer.effect(
  PhoneAccess,
  Effect.gen(function* () {
    const status = yield* Ref.make(OFF_STATUS);
    return PhoneAccess.of({
      getStatus: Ref.get(status),
      setStatus: Effect.fn("PhoneAccess.setStatus")(function* (next: PhoneAccessStatus) {
        yield* Ref.set(status, next);
      }),
    });
  }),
);

// Quick tunnels can take a while to be assigned when Cloudflare is busy.
const TUNNEL_START_TIMEOUT = Duration.seconds(90);
// The relay keeps the last registration, so this only repairs a reset or a lost claim.
const REREGISTER_INTERVAL = Duration.minutes(10);
const REGISTER_RETRY_DELAY = Duration.seconds(10);
const restartBackoff = Schedule.exponential("2 seconds").pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, Duration.minutes(2))),
  ),
);

type SessionEnd = { readonly state: "claimed_elsewhere" | "error"; readonly error: string | null };

/**
 * Keeps phone access matching the settings for the server at `localOrigin`
 * until interrupted. Each change of the toggle or relay restarts the tunnel.
 */
export const runPhoneAccess = Effect.fn("PhoneAccess.run")(function* (localOrigin: string) {
  const phone = yield* PhoneAccess;
  const settings = yield* Settings.ServerSettingsService;
  const relayClient = yield* RelayClient.RelayClient;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const httpClient = yield* HttpClient.HttpClient;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const policy = yield* ManagedPolicy.ManagedPolicy;

  const report = (
    relayUrl: string,
    state: PhoneAccessState,
    details: { readonly tunnelUrl?: string | null; readonly error?: string | null } = {},
  ) =>
    phone.setStatus({
      enabled: state !== "off",
      state,
      relayUrl,
      tunnelUrl: details.tunnelUrl ?? null,
      error: details.error ?? null,
    });

  const readSecret = secrets
    .getOrCreateRandom(PHONE_RELAY_SECRET_NAME, PHONE_RELAY_SECRET_BYTES)
    .pipe(
      Effect.map(encodePhoneRelaySecret),
      Effect.mapError(
        (cause) =>
          new PhoneAccessError({ message: `Could not read the relay secret: ${cause.message}` }),
      ),
    );

  const register = (relayUrl: string, tunnelUrl: string, secret: string) =>
    HttpClientRequest.post(`${relayUrl}${PHONE_RELAY_REGISTER_PATH}`).pipe(
      HttpClientRequest.bearerToken(secret),
      HttpClientRequest.bodyJson({ origin: tunnelUrl }),
      Effect.flatMap(httpClient.execute),
      Effect.flatMap((response) =>
        response.text.pipe(
          Effect.map((body) => classifyRegistrationResponse(response.status, body)),
        ),
      ),
      Effect.timeout("15 seconds"),
      Effect.catch((cause) =>
        Effect.succeed({ kind: "retry" as const, reason: `Relay unreachable: ${cause.message}` }),
      ),
    );

  const ensureExecutable = relayClient.resolve.pipe(
    Effect.flatMap((status) =>
      status.status === "available"
        ? Effect.succeed(status)
        : status.status === "unsupported"
          ? Effect.fail(
              new PhoneAccessError({
                message: `cloudflared is not available for ${status.platform}-${status.arch}`,
              }),
            )
          : relayClient.install.pipe(
              Effect.mapError(
                (cause) =>
                  new PhoneAccessError({
                    message: `Could not install cloudflared: ${cause.message}`,
                  }),
              ),
            ),
    ),
  );

  /** One cloudflared run; fails when it exits, ends when the relay turns it away. */
  const session = Effect.fn("PhoneAccess.session")(function* (relayUrl: string) {
    yield* report(relayUrl, "starting");
    const secret = yield* readSecret;
    const executable = yield* ensureExecutable;
    const child = yield* spawner
      .spawn(
        ChildProcess.make(executable.executablePath, quickTunnelArgs({ localOrigin, relayUrl }), {
          detached: false,
          shell: false,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        }),
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new PhoneAccessError({ message: `Could not start cloudflared: ${cause.message}` }),
        ),
      );
    yield* Effect.logInfo("Phone access tunnel starting", {
      pid: Number(child.pid),
      version: executable.version,
    });

    const tunnelUrl = yield* Deferred.make<string>();
    const connected = yield* Deferred.make<void>();
    yield* child.all.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach((line) => {
        const url = parseQuickTunnelUrl(line);
        return Effect.all([
          url === null ? Effect.void : Deferred.succeed(tunnelUrl, url),
          isTunnelConnectionRegistered(line) ? Deferred.succeed(connected, undefined) : Effect.void,
          Effect.logDebug("cloudflared", { output: line.trim() }),
        ]);
      }),
      Effect.ignore,
      Effect.forkScoped,
    );

    const exited = child.exitCode.pipe(
      Effect.flatMap((code) =>
        Effect.fail(
          new PhoneAccessError({ message: `cloudflared exited with code ${Number(code)}` }),
        ),
      ),
      Effect.mapError((cause) =>
        cause._tag === "PhoneAccessError"
          ? cause
          : new PhoneAccessError({ message: `cloudflared stopped: ${cause.message}` }),
      ),
    );

    const registered = Effect.gen(function* () {
      const url = yield* Deferred.await(tunnelUrl).pipe(
        Effect.tap(() => Deferred.await(connected)),
        Effect.timeoutOrElse({
          duration: TUNNEL_START_TIMEOUT,
          orElse: () =>
            Effect.fail(
              new PhoneAccessError({ message: "Cloudflare did not assign a quick tunnel" }),
            ),
        }),
      );
      yield* report(relayUrl, "registering", { tunnelUrl: url });
      while (true) {
        const outcome = yield* register(relayUrl, url, secret);
        switch (outcome.kind) {
          case "registered":
            yield* report(relayUrl, "connected", { tunnelUrl: url });
            yield* Effect.logInfo("Phone access registered with the relay", { relayUrl });
            yield* Effect.sleep(REREGISTER_INTERVAL);
            break;
          case "claimed_elsewhere":
            return {
              state: "claimed_elsewhere",
              error:
                "Another AgentDock install owns this relay. Reset the relay or use another one.",
            } satisfies SessionEnd;
          case "rejected":
            return {
              state: "error",
              error: `The relay refused: ${outcome.reason}`,
            } satisfies SessionEnd;
          case "retry":
            yield* report(relayUrl, "registering", { tunnelUrl: url, error: outcome.reason });
            yield* Effect.sleep(REGISTER_RETRY_DELAY);
            break;
        }
      }
    });

    return yield* Effect.raceFirst(registered, exited);
  }, Effect.scoped);

  const apply = Effect.fn("PhoneAccess.apply")(function* (desired: {
    readonly enabled: boolean;
    readonly relaySetting: string;
  }) {
    const relayUrl = resolvePhoneRelayUrl(desired.relaySetting);
    if (!desired.enabled) {
      yield* report(relayUrl ?? DEFAULT_PHONE_RELAY_URL, "off");
      return;
    }
    if (relayUrl === null) {
      yield* report(desired.relaySetting, "error", {
        error: "The relay URL must be an https:// address with no path.",
      });
      return;
    }
    if (!ManagedLimits.allowsRemoteClients(policy)) {
      yield* report(relayUrl, "error", {
        error: ManagedLimits.refuseRemoteClients(policy).message,
      });
      return;
    }
    const end = yield* session(relayUrl).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("Phone access tunnel stopped; restarting", { error: error.message }).pipe(
          Effect.andThen(report(relayUrl, "error", { error: error.message })),
        ),
      ),
      Effect.retry(restartBackoff),
    );
    yield* Effect.logWarning("Phone access stopped", { reason: end.error });
    yield* report(relayUrl, end.state, { error: end.error });
  });

  const desired = Stream.unwrap(
    Effect.gen(function* () {
      const changes = yield* settings.subscribeChanges;
      const current = yield* settings.getSettings.pipe(Effect.option);
      return Stream.concat(
        Option.match(current, { onNone: () => Stream.empty, onSome: Stream.succeed }),
        changes,
      );
    }),
  ).pipe(
    Stream.map((value) => ({
      enabled: value.phoneAccessEnabled,
      relaySetting: value.phoneRelayUrl,
    })),
    Stream.changesWith(
      (left, right) => left.enabled === right.enabled && left.relaySetting === right.relaySetting,
    ),
  );

  yield* desired.pipe(
    Stream.switchMap((value) => Stream.fromEffect(apply(value))),
    Stream.runDrain,
  );
});
