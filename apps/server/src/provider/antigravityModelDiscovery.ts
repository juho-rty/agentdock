/**
 * Antigravity lists models only from a running session, and a provider without models is
 * left out of the picker, so an account added with an existing sign-in never gets any.
 * This loads the list once, as the settings page's model refresh does.
 */
import { ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ProviderInstanceRegistry from "./ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";

const ANTIGRAVITY = ProviderDriverKind.make("antigravity");

/** An installed, usable Antigravity account that has never listed its models. */
export function needsAntigravityModelDiscovery(provider: ServerProvider): boolean {
  return (
    provider.driver === ANTIGRAVITY &&
    provider.enabled &&
    provider.installed &&
    provider.status !== "error" &&
    provider.auth.status !== "unauthenticated" &&
    provider.models.length === 0
  );
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const providers = yield* ProviderRegistry.ProviderRegistry;
    const instances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
    // Each discovery unpacks the agent bundle, so they run one at a time.
    const oneAtATime = yield* Semaphore.make(1);
    // Once per account per server run: a failure says so in settings rather than retrying.
    const attempted = new Set<string>();

    const discover = Effect.fn("AntigravityModelDiscovery.discover")(
      function* (provider: ServerProvider) {
        const instance = yield* instances.getInstance(provider.instanceId);
        if (instance?.refreshModels === undefined) return;
        yield* Effect.logInfo("loading Antigravity models for an account without any", {
          instanceId: provider.instanceId,
        });
        yield* instance.refreshModels();
        yield* providers.refreshInstance(provider.instanceId);
      },
      Effect.ignoreCause({ log: true }),
    );

    yield* Stream.concat(Stream.fromEffect(providers.getProviders), providers.streamChanges).pipe(
      Stream.runForEach((snapshot) =>
        Effect.forEach(
          snapshot.filter(
            (provider) =>
              needsAntigravityModelDiscovery(provider) && !attempted.has(provider.instanceId),
          ),
          (provider) => {
            attempted.add(provider.instanceId);
            return oneAtATime.withPermits(1)(discover(provider)).pipe(Effect.forkScoped);
          },
          { discard: true },
        ),
      ),
      Effect.forkScoped,
    );
  }),
);
