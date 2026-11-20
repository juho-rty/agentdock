/**
 * Pairs a phone with the environments linked to the one it already uses, so each machine
 * needs no pairing link of its own. The phone asks its environment (`linkedPairings`),
 * which asks every link with the link's token (`issueForLink`); the phone then redeems
 * each code at that machine's phone relay.
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
import * as PhoneAccess from "../phone/PhoneAccess.ts";
import * as PeerLinks from "./PeerLinks.ts";

const ISSUE_PATH = "/api/peer-link/device-pairing";
const ISSUE_TIMEOUT = "15 seconds";

const forbidden = (message: string) => Effect.fail(new EnvironmentHttpForbiddenError({ message }));

export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "devicePairing",
  Effect.fnUntraced(function* (handlers) {
    const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
    const environment = yield* ServerEnvironment.ServerEnvironment;
    const phoneAccess = yield* PhoneAccess.PhoneAccess;
    const links = yield* PeerLinks.PeerLinks;
    const httpClient = yield* HttpClient.HttpClient;

    const askLink = Effect.fnUntraced(function* (environmentId: EnvironmentId) {
      const resolved = yield* links.resolve(environmentId);
      const response = yield* HttpClientRequest.post(`${resolved.url}${ISSUE_PATH}`).pipe(
        HttpClientRequest.bearerToken(resolved.token),
        httpClient.execute,
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(LinkedDevicePairing)),
        Effect.timeout(ISSUE_TIMEOUT),
      );
      // A link that answers as another machine must not hand the phone that machine's code.
      return response.environmentId === environmentId ? response : null;
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
            return yield* forbidden("Only a full-access linked environment may pair a phone here.");
          }
          const status = yield* phoneAccess.getStatus;
          if (!status.enabled || status.state !== "connected") {
            return yield* forbidden("Phone access is not running on this environment.");
          }
          const descriptor = yield* environment.getDescriptor;
          const issued = yield* serverAuth
            .issuePairingCredential({
              scopes: AuthStandardClientScopes,
              label: `Phone via ${session.label}`,
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
            relayUrl: status.relayUrl,
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
            linked.filter((link) => !known.has(link.environmentId)),
            (link) =>
              askLink(link.environmentId).pipe(
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
