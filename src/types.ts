// ─── Shared TypeScript types ─────────────────────────────────

/**
 * A named set of mods to have active, and the order to load them in.
 *
 * `enabledModIds` is the complete list: applying a profile disables anything
 * it does not name.
 */
export interface Profile {
  id: string;
  name: string;
  enabledModIds: string[];
  order: string[];
  createdAt: string;
}

/** What applying a profile actually did. */
export interface ApplyReport {
  enabled: number;
  disabled: number;
  /** Mods the profile names that are no longer installed. */
  missing: number;
  orderUnchanged: boolean;
}

/** Whether what the library claims is installed is actually on disk. */
export type ModIntegrity = "ok" | "incomplete" | "missing" | "modified";

export interface Mod {
  id: string;
  name: string;
  author?: string;
  version?: string;
  description?: string;
  thumbnailUrl?: string;
  imageUrl?: string;
  tags?: string[];
  parentModId?: string;
  pakFiles: string[];
  pakchunks: number[];
  checksum: string;
  enabled: boolean;
  loadOrder: number;
  installedAt: string;
  sourceUrl?: string;
  /** Bytes the mod's files take in ~mods, measured at listing time. */
  sizeBytes: number;
  /**
   * Presence on disk, recomputed on every listing. `modified` only ever
   * arrives from an explicit verification, never from a plain load.
   */
  integrity: ModIntegrity;
  /** The user's own note about this mod. */
  notes?: string;
  /** Pinned by the user. */
  favourite: boolean;
}

/** How a mod fares against the others claiming its pakchunks. */
export interface ConflictStanding {
  chunks: number[];
  /** Name of the mod that overrides this one, when it loses. */
  overriddenBy?: string;
}

export interface UpdateAvailable {
  modId: string;
  modName: string;
  currentVersion: string | null;
  newVersion: string;
  pageUrl: string;
  downloadUrl: string;
  lastUpdated: string;
}

export interface ConflictInfo {
  pakchunk: number;
  mods: string[]; // mod ids
  modNames: string[]; // mod names
}

export interface CatalogMod {
  overtakeId: string;
  title: string;
  url: string;
  version: string | null;
  author: string | null;
  description: string | null;
  imageUrl: string | null;
  downloadCount: number | null;
  lastUpdated: string;
}

export interface CatalogStats {
  count: number;
  lastSync: string;
}

export type DownloadStatus =
  | "queued"
  | "login_required"
  | "initiating"
  | "connecting"
  | "downloading"
  | "verifying"
  | "installing"
  | "awaiting_input"
  | "completed"
  | "error"
  | "canceled";

/** One of several interchangeable copies of a mod inside a single archive. */
export interface InstallVariant {
  id: string;
  label: string;
  files: string[];
}

/** An install either finished, or stopped to ask which version to use. */
export type InstallOutcome =
  | { kind: "installed"; modId: string }
  | { kind: "needsVariant"; stagingId: string; variants: InstallVariant[] };

export interface PendingVariantChoice {
  stagingId: string;
  title: string;
  variants: InstallVariant[];
  /** Present when the install came from the download queue. */
  jobId?: string;
}

/** Statuses that occupy the single download slot. */
export const ACTIVE_STATUSES: readonly DownloadStatus[] = [
  "initiating",
  "connecting",
  "downloading",
  "verifying",
  "installing",
  // Waiting on the user still owns the slot: starting the next download would
  // extract a second archive on top of the parked one.
  "awaiting_input",
];

export function isActiveStatus(status: DownloadStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export interface DownloadJob {
  jobId: string; // overtakeId for catalog mods, modId for updates
  title: string;
  pageUrl: string;
  downloadUrl: string;
  status: DownloadStatus;
  progress: number;
  /** Bytes written so far (the webview never reports a total). */
  downloadedBytes?: number;
  /** Bytes per second, from the backend byte monitor. */
  speed?: number;
  filename?: string;
  error?: string;
  /** Automatic retries already spent on this job. */
  retries?: number;
}

export type UpdateStage =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export interface AppUpdateState {
  stage: UpdateStage;
  version?: string;
  notes?: string;
  /** 0-100 while downloading; undefined when the size is unknown. */
  progress?: number;
  error?: string;
}

export type NotificationKind = "info" | "success" | "error";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  message?: string;
  timestamp: number;
  read: boolean;
}
