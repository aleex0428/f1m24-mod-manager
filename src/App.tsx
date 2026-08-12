import { useCallback, useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import { selectActiveJobCount, useModStore } from "./store/modStore";
import { PitWallDownloads } from "./components/PitWallDownloads";
import { Sidebar } from "./components/Sidebar";
import { PlayButton } from "./components/PlayButton";
import { InstallPromptModal } from "./components/InstallPromptModal";
import { NotificationCenter } from "./components/NotificationCenter";
import { WindowControls } from "./components/WindowControls";
import { WhatsNewModal } from "./components/WhatsNewModal";
import { SessionWarningModal } from "./components/SessionWarningModal";
import { VariantPickerModal } from "./components/VariantPickerModal";
import { extractUrlFromDeepLink } from "./lib/deepLink";
import { enqueueDownload } from "./lib/queue";
import { STARTUP_CHECK_DELAY_MS, checkForAppUpdate } from "./lib/update";
import { Library } from "./pages/Library";
import { Browse } from "./pages/Browse";
import { Settings } from "./pages/Settings";
import { useMods } from "./hooks/useMods";
import { useDownload } from "./hooks/useDownload";

function AppShell() {
  const [isPitWallOpen, setIsPitWallOpen] = useState(false);
  const [deepLinkUrl, setDeepLinkUrl] = useState<string | null>(null);
  const [isAuthWarningOpen, setIsAuthWarningOpen] = useState(false);

  const navigate = useNavigate();
  const activeJobCount = useModStore(selectActiveJobCount);
  const gamePathValid = useModStore((s) => s.gamePathValid);
  const { conflicts, loadMods } = useMods();

  useDownload();

  // ─── One-time bootstrap ─────────────────────────────────
  useEffect(() => {
    const store = useModStore.getState();

    loadMods();

    invoke<string>("get_app_version")
      .then(store.setAppVersion)
      .catch(() => {});

    invoke<boolean>("get_auth_status")
      .then(store.setLoggedIn)
      .catch(() => {});

    const resolveGamePath = async () => {
      let path = await invoke<string>("get_setting", { key: "game_path" }).catch(() => "");

      if (!path) {
        path = await invoke<string>("detect_game_path").catch(() => "");
        if (path) {
          await invoke("save_setting", { key: "game_path", value: path }).catch(() => {});
          toast.success("Game folder detected automatically");
        }
      }

      useModStore.getState().setGamePath(path ?? "");
      const valid = await invoke<boolean>("validate_game_path").catch(() => false);
      useModStore.getState().setGamePathValid(valid);
    };

    resolveGamePath();

    // Silent: an unreachable release endpoint must not bother the user.
    const updateTimer = setTimeout(() => {
      checkForAppUpdate(true);
    }, STARTUP_CHECK_DELAY_MS);

    return () => clearTimeout(updateTimer);
  }, [loadMods]);

  // ─── Global backend events ──────────────────────────────
  useEffect(() => {
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];

    const register = <T,>(event: string, handler: (payload: T) => void) => {
      listen<T>(event, (e) => handler(e.payload))
        .then((fn) => {
          if (disposed) fn();
          else unlisteners.push(fn);
        })
        .catch(() => {
          // No Tauri runtime available.
        });
    };

    register<string>("deep-link-received", (payload) => {
      const url = extractUrlFromDeepLink(payload ?? "");
      if (url) setDeepLinkUrl(url);
    });

    register("auth-required", () => setIsAuthWarningOpen(true));

    // Mods are installed on a backend thread; this is the single place the
    // library is refreshed when one lands.
    register("mod-installed", () => {
      loadMods();
    });

    // A download turned out to hold several versions of the same mod.
    register<{
      jobId?: string;
      stagingId: string;
      title: string;
      variants: { id: string; label: string; files: string[] }[];
    }>("install-variant-required", (payload) => {
      useModStore.getState().setPendingVariant(payload);
      setIsPitWallOpen(false);
    });

    // The backend confirmed a real session — dismiss any sign-in prompt.
    register("auth-linked", () => {
      setIsAuthWarningOpen(false);
      toast.success("Overtake.gg account linked", { id: "overtake-login" });
      useModStore.getState().pushNotification(
        "success",
        "Account linked",
        "Downloads from Overtake.gg are enabled."
      );
    });

    return () => {
      disposed = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [loadMods]);

  // ─── Keyboard shortcuts ─────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.shiftKey) return;

      const shortcuts: Record<string, () => void> = {
        f: () => window.dispatchEvent(new CustomEvent("app:focus-search")),
        "1": () => navigate("/library"),
        "2": () => navigate("/browse"),
        "3": () => navigate("/settings"),
      };

      const action = shortcuts[e.key];
      if (action) {
        e.preventDefault();
        action();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  const handleConfirmDeepLink = useCallback(async (url: string) => {
    if (!/^https?:\/\//i.test(url)) {
      toast.error("That link does not point to an Overtake.gg mod page");
      return;
    }

    const queued = enqueueDownload({
      jobId: `link-${url}`,
      title: "Mod from Overtake.gg",
      pageUrl: url,
    });

    if (queued) {
      toast.success("Added to the download queue");
      setIsPitWallOpen(true);
    }
  }, []);

  return (
    <div className="relative flex h-screen overflow-hidden">
      <div className="app-backdrop" />

      <Sidebar />

      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        <header
          data-tauri-drag-region
          className="titlebar flex flex-shrink-0 items-center justify-between border-b border-border/70 bg-bg-secondary/60 py-2 pl-5 pr-0"
        >
          <div data-tauri-drag-region className="flex items-center gap-3">
            <span className="font-display text-sm font-bold tracking-wide text-text-primary">
              F1 MANAGER 24
            </span>
            <span className="h-3.5 w-px bg-border" />
            <span className="text-sm text-text-muted">Mod Manager</span>
          </div>

          <div className="no-drag flex items-center gap-2 pr-0">
            <NotificationCenter />

            <button
              onClick={() => setIsPitWallOpen(true)}
              className="btn-subtle relative h-9 w-9 !px-0"
              title="Downloads"
              aria-label="Downloads"
            >
              <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.6}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              {activeJobCount > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-f1red px-1 font-mono text-[9px] font-bold text-white">
                  {activeJobCount}
                </span>
              )}
            </button>

            <span className="mx-1 h-5 w-px bg-border" />

            <PlayButton conflicts={conflicts} />

            <WindowControls />
          </div>
        </header>

        {!gamePathValid && (
          <NavLink
            to="/settings"
            className="flex flex-shrink-0 items-center gap-2 border-b border-warning/20 bg-warning/10 px-5 py-2 text-xs text-warning transition-colors hover:bg-warning/15"
          >
            <svg className="h-4 w-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            Game folder not set or invalid — mods cannot be installed. Open Settings to fix it.
          </NavLink>
        )}

        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<Navigate to="/library" replace />} />
            <Route path="/library" element={<Library />} />
            <Route path="/browse" element={<Browse />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/library" replace />} />
          </Routes>
        </main>
      </div>

      <PitWallDownloads isOpen={isPitWallOpen} onClose={() => setIsPitWallOpen(false)} />

      <InstallPromptModal
        isOpen={deepLinkUrl !== null}
        url={deepLinkUrl}
        onClose={() => setDeepLinkUrl(null)}
        onConfirm={handleConfirmDeepLink}
      />

      <SessionWarningModal isOpen={isAuthWarningOpen} onClose={() => setIsAuthWarningOpen(false)} />

      <VariantPickerModal />

      <WhatsNewModal />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
