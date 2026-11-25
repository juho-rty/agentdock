/**
 * Pairs a phone with the environments linked to the one it already uses, so each machine
 * needs no pairing link of its own. The phone asks its environment (`linkedPairings`),
 * which asks every link with the link's token (`issueForLink`); the phone then redeems
 * each code at the address this environment reaches that link at.
 */
import {
  AuthAccessWriteScope,
  AuthStandardClientScopes,
  EnvironmentHttpApi,
  EnvironmentHttpForbiddenError,
  LinkedDevicePairing,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import {
  annotateEnvironmentRequest,
  failEnvironmentAuthInvalid,
  failEnvironmentInternal,
  requireEnvironmentScope,
} from "../auth/http.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as PeerLinks from "./PeerLinks.ts";

const ISSUE_PATH = "/api/peer-link/device-pairing";
// Shorter than the phone's request timeout even after `links.list` has probed every link, so
// one slow link cannot cost the phone the codes the other links already issued.
const ISSUE_TIMEOUT = "6 seconds";

const forbidden = (message: string) => Effect.fail(new EnvironmentHttpForbiddenError({ message }));

export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "devicePairing",
  Effect.fnUntraced(function* (handlers) {
    const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
    const environment = yield* ServerEnvironment.ServerEnvironment;
    const links = yield* PeerLinks.PeerLinks;
    const httpClient = yield* HttpClient.HttpClient;

    const askLink = Effect.fnUntraced(function* (environmentId: EnvironmentId) {
      const resolved = yield* links.resolve(environmentId);
      const response = yield* HttpClientRequest.post(`${resolved.url}${ISSUE_PATH}`).pipe(
        HttpClientRequest.bearerToken(resolved.token),
        httpClient.execute,
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(LinkedDevicePairing)),
      );
      // A link that answers as another machine must not hand the client that machine's code.
      return response.environmentId === environmentId
        ? { ...response, directUrl: resolved.url }
        : null;
    });

    return handlers
      .handle(
        "issueForLink",
        Effect.fn("environment.devicePairing.issueForLink")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          const request = yield* HttpServerRequest.HttpServerRequest;
          const session = yield* serverAuth.authenticateMcpClient(request).pipe(
            Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
              failEnvironmentInternal("internal_error", error),
            ),
            Effect.catch(() => failEnvironmentAuthInvalid("invalid_credential")),
          );
          // A full-access link already runs agents here as this user, so a client session
          // gives it nothing new; a narrower link must not gain one.
          if (!session.peerLink || session.access !== "full-access") {
            return yield* forbidden(
              "Only a full-access linked environment may pair a device here.",
            );
          }
          const descriptor = yield* environment.getDescriptor;
          const issued = yield* serverAuth
            .issuePairingCredential({
              scopes: AuthStandardClientScopes,
              label: `Linked device via ${session.label}`,
            })
            .pipe(
              Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
                failEnvironmentInternal("pairing_credential_issuance_failed", error),
              ),
              Effect.catchTags({
                ManagedPolicyRefusedError: (error) => forbidden(error.message),
              }),
            );
          return {
            environmentId: descriptor.environmentId,
            label: descriptor.label,
            // Nothing relays any more; the field stays so older phones and computers decode this.
            relayUrl: "",
            credential: issued.credential,
          };
        }),
      )
      .handle(
        "linkedPairings",
        Effect.fn("environment.devicePairing.linkedPairings")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          // The same scope that lets this device make a pairing link by hand.
          yield* requireEnvironmentScope(AuthAccessWriteScope);
          const known = new Set<string>(args.payload.knownEnvironmentIds);
          const linked = yield* links.list.pipe(Effect.orElseSucceed(() => []));
          const pairings = yield* Effect.forEach(
            // A link that did not answer the probe would only hold the reachable ones back.
            linked.filter((link) => link.status === "reachable" && !known.has(link.environmentId)),
            (link) =>
              askLink(link.environmentId).pipe(
                Effect.timeout(ISSUE_TIMEOUT),
                // An unreachable or unwilling link is skipped; the phone asks again next start.
                Effect.catchCause((cause) =>
                  Effect.logInfo("linked environment gave no phone pairing", {
                    environmentId: link.environmentId,
                    cause,
                  }).pipe(Effect.as(null)),
                ),
              ),
            { concurrency: 4 },
          );
          return { pairings: pairings.filter((pairing) => pairing !== null) };
        }),
      );
  }),
);
