import { create } from "zustand";
import type {
  AppNotification,
  AppUpdateState,
  ConflictInfo,
  DownloadJob,
  Mod,
  NotificationKind,
  PendingVariantChoice,
} from "../types";
import { isActiveStatus } from "../types";

const MAX_NOTIFICATIONS = 40;

interface ModStore {
  // ─── Mod state ───────────────────────────────────────────
  mods: Mod[];
  conflicts: ConflictInfo[];
  isLoading: boolean;
  error: string | null;

  // ─── Download queue ──────────────────────────────────────
  jobs: Record<string, DownloadJob>;
  isQueuePaused: boolean;

  // ─── App state ───────────────────────────────────────────
  gamePath: string;
  gamePathValid: boolean;
  /** True while F1Manager24.exe is running and the .pak files are locked. */
  gameRunning: boolean;
  /** The game's executable changed since last launch — mods may be broken. */
  gamePatched: boolean;
  appVersion: string;
  isLoggedIn: boolean;
  notifications: AppNotification[];
  appUpdate: AppUpdateState;
  /** Set while an install waits for the user to choose a version. */
  pendingVariant: PendingVariantChoice | null;

  // ─── Actions ─────────────────────────────────────────────
  setMods: (mods: Mod[]) => void;
  updateMod: (id: string, changes: Partial<Mod>) => void;
  reorderMods: (orderedIds: string[]) => void;
  setConflicts: (conflicts: ConflictInfo[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  upsertJob: (job: DownloadJob) => void;
  updateJob: (jobId: string, changes: Partial<DownloadJob>) => void;
  removeJob: (jobId: string) => void;
  clearInactiveJobs: () => void;
  setQueuePaused: (paused: boolean) => void;
  requeueLoginRequiredJobs: () => void;

  setGamePath: (path: string) => void;
  setGamePathValid: (valid: boolean) => void;
  setGameRunning: (running: boolean) => void;
  setGamePatched: (patched: boolean) => void;
  setAppVersion: (v: string) => void;
  setLoggedIn: (v: boolean) => void;

  pushNotification: (kind: NotificationKind, title: string, message?: string) => void;
  markNotificationsRead: () => void;
  clearNotifications: () => void;

  setAppUpdate: (changes: Partial<AppUpdateState>) => void;
  setPendingVariant: (choice: PendingVariantChoice | null) => void;
}

export const useModStore = create<ModStore>((set) => ({
  mods: [],
  conflicts: [],
  isLoading: false,
  error: null,

  jobs: {},
  isQueuePaused: false,

  gamePath: "",
  gamePathValid: false,
  gameRunning: false,
  gamePatched: false,
  appVersion: "1.0.0",
  isLoggedIn: false,
  notifications: [],
  appUpdate: { stage: "idle" },
  pendingVariant: null,

  setMods: (mods) =>
    set({ mods: [...mods].sort((a, b) => a.loadOrder - b.loadOrder) }),

  updateMod: (id, changes) =>
    set((state) => ({
      mods: state.mods.map((m) => (m.id === id ? { ...m, ...changes } : m)),
    })),

  reorderMods: (orderedIds) =>
    set((state) => {
      const map = new Map(state.mods.map((m) => [m.id, m]));
      const reordered = orderedIds
        .map((id, idx) => {
          const mod = map.get(id);
          return mod ? { ...mod, loadOrder: idx } : null;
        })
        .filter(Boolean) as Mod[];
      return { mods: reordered };
    }),

  setConflicts: (conflicts) => set({ conflicts }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  upsertJob: (job) =>
    set((state) => ({ jobs: { ...state.jobs, [job.jobId]: job } })),

  updateJob: (jobId, changes) =>
    set((state) => {
      const job = state.jobs[jobId];
      if (!job) return state;
      // Skip the re-render when nothing actually changed.
      const changed = (Object.keys(changes) as (keyof DownloadJob)[]).some(
        (key) => job[key] !== changes[key]
      );
      if (!changed) return state;
      return { jobs: { ...state.jobs, [jobId]: { ...job, ...changes } } };
    }),

  removeJob: (jobId) =>
    set((state) => {
      if (!state.jobs[jobId]) return state;
      const jobs = { ...state.jobs };
      delete jobs[jobId];
      return { jobs };
    }),

  clearInactiveJobs: () =>
    set((state) => {
      const jobs: Record<string, DownloadJob> = {};
      for (const [id, job] of Object.entries(state.jobs)) {
        if (isActiveStatus(job.status) || job.status === "queued") jobs[id] = job;
      }
      return { jobs };
    }),

  setQueuePaused: (isQueuePaused) => set({ isQueuePaused }),

  requeueLoginRequiredJobs: () =>
    set((state) => {
      let touched = false;
      const jobs = { ...state.jobs };
      for (const key of Object.keys(jobs)) {
        if (jobs[key].status === "login_required") {
          jobs[key] = { ...jobs[key], status: "queued", error: undefined };
          touched = true;
        }
      }
      return touched ? { jobs } : state;
    }),

  setGamePath: (gamePath) => set({ gamePath }),
  setGamePathValid: (gamePathValid) => set({ gamePathValid }),
  setGameRunning: (gameRunning) => set({ gameRunning }),
  setGamePatched: (gamePatched) => set({ gamePatched }),
  setAppVersion: (appVersion) => set({ appVersion }),
  setLoggedIn: (isLoggedIn) => set({ isLoggedIn }),

  pushNotification: (kind, title, message) =>
    set((state) => ({
      notifications: [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind,
          title,
          message,
          timestamp: Date.now(),
          read: false,
        },
        ...state.notifications,
      ].slice(0, MAX_NOTIFICATIONS),
    })),

  markNotificationsRead: () =>
    set((state) =>
      state.notifications.some((n) => !n.read)
        ? { notifications: state.notifications.map((n) => ({ ...n, read: true })) }
        : state
    ),

  clearNotifications: () => set({ notifications: [] }),

  setAppUpdate: (changes) =>
    set((state) => ({ appUpdate: { ...state.appUpdate, ...changes } })),

  setPendingVariant: (pendingVariant) => set({ pendingVariant }),
}));

// ─── Derived selectors ─────────────────────────────────────

export const selectJobList = (state: ModStore) => Object.values(state.jobs);

export const selectActiveJobCount = (state: ModStore) =>
  Object.values(state.jobs).filter(
    (j) => isActiveStatus(j.status) || j.status === "queued"
  ).length;

export const selectUnreadCount = (state: ModStore) =>
  state.notifications.reduce((n, item) => (item.read ? n : n + 1), 0);
