export const DEFAULT_IOS_OTA_MANIFEST_URL =
  "https://s-mac-mini.tail029af8.ts.net/ios/manifest.plist";

export const PERSONAL_TEAM_SIGNING_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const SIGNING_EXPIRY_WARNING_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1_000;

export interface SigningExpiryInfo {
  readonly expiresAtMs: number;
  readonly daysRemaining: number;
  readonly formattedDate: string;
  readonly expiringSoon: boolean;
  readonly expired: boolean;
}

export function parseManifestBundleVersion(plistXml: string): string | null {
  const match = /<key>\s*bundle-version\s*<\/key>\s*<string>\s*([^<\s]+)\s*<\/string>/i.exec(
    plistXml,
  );
  return match?.[1]?.trim() || null;
}

export function isNewerBuildVersion(
  installedBuild: string | null | undefined,
  remoteBuild: string | null | undefined,
): boolean {
  const installed = installedBuild?.trim() ?? "";
  const remote = remoteBuild?.trim() ?? "";
  if (!installed || !remote || installed === remote) return false;
  if (/^\d+$/.test(installed) && /^\d+$/.test(remote)) {
    try {
      return BigInt(remote) > BigInt(installed);
    } catch {
      return remote > installed;
    }
  }
  return remote.localeCompare(installed, undefined, { numeric: true }) > 0;
}

export function buildItmsServicesInstallUrl(manifestUrl: string): string {
  const trimmed = manifestUrl.trim();
  const encodedUrl = trimmed.includes("&") ? encodeURIComponent(trimmed) : trimmed;
  return `itms-services://?action=download-manifest&url=${encodedUrl}`;
}

export function parseBuildVersionTimestampMs(
  buildVersion: string | null | undefined,
): number | null {
  const trimmed = buildVersion?.trim() ?? "";
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function resolveSigningExpiryInfo(input: {
  readonly provisioningExpiresAt: string | null | undefined;
  readonly nativeBuildVersion: string | null | undefined;
  readonly nowMs?: number;
}): SigningExpiryInfo | null {
  const nowMs = input.nowMs ?? Date.now();
  const buildTimestampMs = parseBuildVersionTimestampMs(input.nativeBuildVersion);
  const parsedExplicitMs = input.provisioningExpiresAt
    ? Date.parse(input.provisioningExpiresAt)
    : Number.NaN;

  let expiresAtMs: number | null = null;
  if (Number.isFinite(parsedExplicitMs)) {
    // If Xcode renewed an expired profile mid-build after app.config evaluated, fall back to build + 7d.
    if (buildTimestampMs !== null && parsedExplicitMs <= buildTimestampMs) {
      expiresAtMs = buildTimestampMs + PERSONAL_TEAM_SIGNING_TTL_MS;
    } else {
      expiresAtMs = parsedExplicitMs;
    }
  } else if (buildTimestampMs !== null) {
    expiresAtMs = buildTimestampMs + PERSONAL_TEAM_SIGNING_TTL_MS;
  }

  if (expiresAtMs === null) return null;

  const remainingMs = expiresAtMs - nowMs;
  const daysRemaining = remainingMs <= 0 ? 0 : Math.ceil(remainingMs / DAY_MS);
  const expiryDate = new Date(expiresAtMs);
  const formattedDate = `${String(expiryDate.getFullYear())}-${String(expiryDate.getMonth() + 1).padStart(2, "0")}-${String(expiryDate.getDate()).padStart(2, "0")}`;

  return {
    expiresAtMs,
    daysRemaining,
    formattedDate,
    expiringSoon: daysRemaining <= SIGNING_EXPIRY_WARNING_DAYS,
    expired: remainingMs <= 0,
  };
}
