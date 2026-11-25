/** Auto-pairs full-access linked peer environments over Tailscale/LAN from any connected host. */
import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import { DpopProof } from "@t3tools/client-runtime/relay";
import {
  executeEnvironmentHttpRequest,
  makeEnvironmentHttpApiGroupClient,
} from "@t3tools/client-runtime/rpc";
import { AuthAccessWriteScope, type EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AppState } from "react-native";

import { loadOrCreateProofKey } from "../features/cloud/dpop";
import { buildPairingUrl, candidateMobilePairingHosts } from "../features/connection/pairing";
import { runtime } from "../lib/runtime";
import * as MobileSecureStorage from "../persistence/mobile-secure-storage";
import { appAtomRegistry } from "../state/atom-registry";
import { environmentSession, readEnvironmentScope } from "../state/session";
import { pairEnvironment } from "../state/use-remote-environment-registry";
import { environmentCatalog } from "./catalog";

const ADDED_STORAGE_KEY = "agentdock.auto-linked-environments.v1";
// The host probes every link and then asks each for a code; older hosts take up to 18 s.
const REQUEST_TIMEOUT_MS = 25_000;
const RESYNC_MIN_INTERVAL_MS = 45_000;
const ACTIVE_RESYNC_INTERVAL_MS = 120_000;

async function readAutoAddedIds(): Promise<ReadonlyArray<string>> {
  try {
    const raw = await runtime.runPromise(
      MobileSecureStorage.MobileSecureStorage.pipe(
        Effect.flatMap((storage) => storage.getItem(ADDED_STORAGE_KEY)),
      ),
    );
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

async function rememberAutoAddedId(environmentId: string): Promise<void> {
  try {
    const next = new Set(await readAutoAddedIds());
    next.add(environmentId);
    await runtime.runPromise(
      MobileSecureStorage.MobileSecureStorage.pipe(
        Effect.flatMap((storage) => storage.setItem(ADDED_STORAGE_KEY, JSON.stringify([...next]))),
      ),
    );
  } catch {}
}

const requestLinkedPairingsFromConnection = Effect.fn("mobile.linkedDevicePairing.request")(
  function* (connection: PreparedConnection, knownEnvironmentIds: ReadonlyArray<EnvironmentId>) {
    const endpointUrl = new URL("/api/phone/linked-pairings", connection.httpBaseUrl).toString();
    const client = yield* makeEnvironmentHttpApiGroupClient(
      connection.httpBaseUrl,
      "devicePairing",
    );
    let headers: Record<string, string> = {};
    const auth = connection.httpAuthorization;
    if (auth !== null) {
      if (auth._tag === "Bearer") {
        headers = { authorization: `Bearer ${auth.token}` };
      } else {
        const key = yield* loadOrCreateProofKey();
        const proof = yield* DpopProof.createProof({
          method: "POST",
          url: endpointUrl,
          accessToken: auth.accessToken,
          key,
        });
        headers = {
          authorization: `DPoP ${auth.accessToken}`,
          dpop: proof,
        };
      }
    }
    return yield* executeEnvironmentHttpRequest(
      endpointUrl,
      REQUEST_TIMEOUT_MS,
      client.linkedPairings({
        headers,
        payload: { knownEnvironmentIds: knownEnvironmentIds.slice(0, 64) },
      }),
    );
  },
);

async function syncLinkedEnvironmentsOnce(): Promise<void> {
  const catalog = appAtomRegistry.get(environmentCatalog.catalogValueAtom);
  if (!catalog.isReady || catalog.entries.size === 0) return;

  const savedIds = [...catalog.entries.keys()];
  const addedIds = await readAutoAddedIds();
  const knownIds: EnvironmentId[] = [
    ...savedIds,
    ...addedIds.filter((id): id is EnvironmentId => !savedIds.some((saved) => saved === id)),
  ];

  for (const sourceId of savedIds) {
    if (!readEnvironmentScope(sourceId, AuthAccessWriteScope)) continue;
    const prepared = appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(sourceId));
    if (Option.isNone(prepared)) continue;

    let pairings: ReadonlyArray<{
      readonly environmentId: EnvironmentId;
      readonly relayUrl: string;
      readonly directUrl?: string | undefined;
      readonly credential: string;
    }>;
    try {
      const response = await runtime.runPromise(
        requestLinkedPairingsFromConnection(prepared.value, knownIds),
      );
      pairings = response.pairings;
    } catch {
      continue;
    }

    for (const pairing of pairings) {
      if (knownIds.includes(pairing.environmentId)) continue;
      for (const host of candidateMobilePairingHosts(pairing)) {
        const pairingUrl = buildPairingUrl(host, pairing.credential);
        if (!pairingUrl) continue;
        const outcome = await pairEnvironment(pairingUrl, pairing.environmentId);
        if (outcome.ok) {
          knownIds.push(pairing.environmentId);
          await rememberAutoAddedId(pairing.environmentId);
          break;
        }
      }
    }
  }
}

export function installMobileLinkedDevicePairing(): () => void {
  let syncInFlight: Promise<void> | null = null;
  let lastSyncAtMs = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const trigger = (force = false) => {
    if (AppState.currentState === "background") return;
    if (syncInFlight !== null) return;
    const now = Date.now();
    if (!force && now - lastSyncAtMs < RESYNC_MIN_INTERVAL_MS) return;
    lastSyncAtMs = now;
    syncInFlight = syncLinkedEnvironmentsOnce()
      .catch(() => undefined)
      .finally(() => {
        syncInFlight = null;
      });
  };

  const scheduleFollowUps = () => {
    for (const delayMs of [2_000, 6_000]) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        trigger(true);
      }, delayMs);
      timers.add(timer);
    }
  };

  scheduleFollowUps();
  const unsubscribeCatalog = appAtomRegistry.subscribe(
    environmentCatalog.catalogValueAtom,
    scheduleFollowUps,
  );
  const appStateSubscription = AppState.addEventListener("change", (state) => {
    if (state === "active") trigger(false);
  });
  const interval = setInterval(() => trigger(false), ACTIVE_RESYNC_INTERVAL_MS);

  return () => {
    unsubscribeCatalog();
    appStateSubscription.remove();
    clearInterval(interval);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
}
