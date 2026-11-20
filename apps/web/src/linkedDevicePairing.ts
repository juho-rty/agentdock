/**
 * A phone paired with one machine gets the machines linked to it on its own: the primary
 * environment asks each link for a one-time pairing code, and the phone redeems it at that
 * machine's phone relay. Each environment is added once, so removing one sticks.
 */
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { environmentCatalog } from "./connection/catalog";
import { connectPairing } from "./connection/onboarding";
import { isElectron } from "./env";
import { PrimaryEnvironmentHttpClient } from "./environments/primary/httpClient";
import { runPrimaryHttp } from "./lib/runtime";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { readPrimaryEnvironmentId } from "./state/environments";

const ADDED_STORAGE_KEY = "agentdock:auto-linked-environments";
const READY_POLL_MS = 2_000;
const READY_ATTEMPTS = 30;

function readAdded(): ReadonlyArray<string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(ADDED_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function rememberAdded(environmentId: string): void {
  try {
    const added = new Set(readAdded());
    added.add(environmentId);
    window.localStorage.setItem(ADDED_STORAGE_KEY, JSON.stringify([...added]));
  } catch {
    // Without storage a removed environment comes back on the next start.
  }
}

/** The environments saved on this device, once both the list and the primary are known. */
function readKnownEnvironmentIds(): ReadonlyArray<EnvironmentId> | null {
  const primary = readPrimaryEnvironmentId();
  const catalog = appAtomRegistry.get(environmentCatalog.catalogValueAtom);
  if (primary === null || !catalog.isReady) return null;
  return [...new Set([primary, ...catalog.entries.keys()])];
}

async function pairLinkedEnvironments(known: ReadonlyArray<EnvironmentId>): Promise<void> {
  const added = readAdded();
  const { pairings } = await runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) =>
        client.devicePairing.linkedPairings({
          headers: {},
          payload: {
            knownEnvironmentIds: [
              ...known,
              ...added.filter((id): id is EnvironmentId => !known.some((have) => have === id)),
            ].slice(0, 64),
          },
        }),
      ),
    ),
  );
  for (const pairing of pairings) {
    const result = await runAtomCommand(
      appAtomRegistry,
      connectPairing,
      {
        host: pairing.relayUrl,
        pairingCode: pairing.credential,
        expectedEnvironmentId: pairing.environmentId,
      },
      { reportFailure: false },
    );
    if (result._tag === "Success") rememberAdded(pairing.environmentId);
  }
}

export function startLinkedDevicePairing(): void {
  // The desktop app keeps its own list; this is for a browser reaching one machine.
  if (isElectron || typeof window === "undefined") return;
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    const known = readKnownEnvironmentIds();
    if (known === null && attempts < READY_ATTEMPTS) return;
    window.clearInterval(timer);
    if (known === null) return;
    // Signed out, offline, or an older server without the endpoint; the next start tries again.
    void pairLinkedEnvironments(known).catch(() => undefined);
  }, READY_POLL_MS);
}
