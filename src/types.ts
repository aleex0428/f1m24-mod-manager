// ─── Shared TypeScript types ─────────────────────────────────

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
  | "completed"
  | "error"
  | "canceled";

/** Statuses that occupy the single download slot. */
export const ACTIVE_STATUSES: readonly DownloadStatus[] = [
  "initiating",
  "connecting",
  "downloading",
  "verifying",
  "installing",
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
