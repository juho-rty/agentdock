import { useAtomValue } from "@effect/atom-react";
import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { request } from "@t3tools/client-runtime/rpc";
import { type EnvironmentId, type PhoneAccessStatus, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { useGT } from "gt-react";
import { useEffect } from "react";

import { connectionAtomRuntime } from "~/connection/runtime";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";

const STATUS_POLL_MS = 3_000;

const phoneAccessStatusAtom = Atom.family((environmentId: EnvironmentId) =>
  connectionAtomRuntime
    .atom(
      Effect.flatMap(EnvironmentRegistry.EnvironmentRegistry, (registry) =>
        registry.run(environmentId, request(WS_METHODS.phoneAccessGetStatus, {})),
      ),
    )
    .pipe(Atom.setIdleTTL(60_000), Atom.withLabel(`phone-access:${environmentId}`)),
);

const NO_PHONE_ACCESS_STATUS_ATOM = Atom.make<Atom.Type<ReturnType<typeof phoneAccessStatusAtom>>>(
  AsyncResult.initial(),
).pipe(Atom.keepAlive, Atom.withLabel("phone-access:none"));

/**
 * The server's phone access state, polled while shown. Null when it is not read here or the
 * server predates phone access.
 */
export function usePhoneAccessStatus(
  environmentId: EnvironmentId | null,
  enabled: boolean,
): PhoneAccessStatus | null {
  const atom =
    enabled && environmentId !== null
      ? phoneAccessStatusAtom(environmentId)
      : NO_PHONE_ACCESS_STATUS_ATOM;
  const result = useAtomValue(atom);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the server; the tunnel changes state on its own
  useEffect(() => {
    if (!enabled || environmentId === null) return;
    const timer = setInterval(() => {
      appAtomRegistry.refresh(phoneAccessStatusAtom(environmentId));
    }, STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, environmentId]);
  return AsyncResult.getOrElse(result, () => null);
}

export function PhoneAccessRow({
  title,
  enabled,
  status,
  canWrite,
  managed,
  onEnabledChange,
}: {
  readonly title: string;
  /** The saved setting, which the status follows a moment later. */
  readonly enabled: boolean;
  readonly status: PhoneAccessStatus | null;
  readonly canWrite: boolean;
  readonly managed?: string | undefined;
  readonly onEnabledChange: (enabled: boolean) => void;
}) {
  const gt = useGT();
  const relayUrl = status?.relayUrl ?? null;
  const description = (() => {
    if (!enabled || status === null || status.state === "off") {
      return gt(
        "Open AgentDock from your phone anywhere through a Cloudflare tunnel. Network access is not needed; phones still sign in with a pairing link.",
      );
    }
    switch (status.state) {
      case "starting":
        return gt("Starting the Cloudflare tunnel…");
      case "registering":
        return gt("Connecting the tunnel to {url}…", { url: status.relayUrl });
      case "connected":
        return gt("Create a pairing link under Authorized clients to sign a phone in.");
      case "claimed_elsewhere":
        return gt("Another AgentDock install owns {url}.", { url: status.relayUrl });
      case "error":
        return gt("Phone access is not running.");
    }
  })();
  return (
    <SettingsRow
      title={title}
      description={
        status?.state === "connected" && relayUrl ? (
          <>
            <a
              href={relayUrl}
              target="_blank"
              rel="noreferrer"
              className="break-all underline underline-offset-2"
            >
              {relayUrl}
            </a>{" "}
            {description}
          </>
        ) : (
          description
        )
      }
      status={
        enabled && status?.error ? (
          <span className="block text-destructive">{status.error}</span>
        ) : null
      }
      control={
        <Switch
          checked={enabled}
          disabled={!canWrite}
          onCheckedChange={(checked) => onEnabledChange(checked)}
          aria-label={gt("Enable phone access")}
        />
      }
      managed={enabled ? undefined : managed}
    />
  );
}
