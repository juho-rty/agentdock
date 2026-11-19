import * as Schema from "effect/Schema";

export const RelayClientStatusSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    executablePath: Schema.String,
    source: Schema.Literals(["override", "managed", "path"]),
    version: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literal("missing"),
    version: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literal("unsupported"),
    platform: Schema.String,
    arch: Schema.String,
    version: Schema.String,
  }),
]);
export type RelayClientStatus = typeof RelayClientStatusSchema.Type;

export const RelayClientInstallProgressStageSchema = Schema.Literals([
  "checking",
  "waiting_for_lock",
  "downloading",
  "verifying",
  "installing",
  "validating",
  "activating",
]);
export type RelayClientInstallProgressStage = typeof RelayClientInstallProgressStageSchema.Type;

export const RelayClientInstallProgressEventSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("progress"),
    stage: RelayClientInstallProgressStageSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("complete"),
    status: RelayClientStatusSchema,
  }),
]);
export type RelayClientInstallProgressEvent = typeof RelayClientInstallProgressEventSchema.Type;

export const RelayClientInstallFailureReasonSchema = Schema.Literals([
  "download_failed",
  "invalid_checksum",
  "install_locked",
  "managed_by_policy",
  "override_missing",
  "unsupported_platform",
  "validation_failed",
  "write_failed",
]);
export type RelayClientInstallFailureReason = typeof RelayClientInstallFailureReasonSchema.Type;

export class RelayClientInstallFailedError extends Schema.TaggedError<RelayClientInstallFailedError>()(
  "RelayClientInstallFailedError",
  {
    reason: RelayClientInstallFailureReasonSchema,
    message: Schema.String,
  },
) {}

export const PhoneAccessStateSchema = Schema.Literals([
  "off",
  "starting",
  "registering",
  "connected",
  "claimed_elsewhere",
  "error",
]);
export type PhoneAccessState = typeof PhoneAccessStateSchema.Type;

/** The Cloudflare phone relay: a quick tunnel from this host, reached through a stable Worker URL. */
export const PhoneAccessStatusSchema = Schema.Struct({
  enabled: Schema.Boolean,
  state: PhoneAccessStateSchema,
  /** The stable URL phones open; it stays the same across tunnel restarts. */
  relayUrl: Schema.String,
  /** The current quick tunnel, or null before one is up. */
  tunnelUrl: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export type PhoneAccessStatus = typeof PhoneAccessStatusSchema.Type;
