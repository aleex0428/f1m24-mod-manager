import { useCallback, useEffect, useMemo, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import toast from "react-hot-toast";

import { useModStore } from "./store/modStore";
import { PitWallDownloads } from "./components/PitWallDownloads";
import { Sidebar } from "./components/Sidebar";
import { PlayButton } from "./components/PlayButton";
import { InstallPromptModal } from "./components/InstallPromptModal";
import { NotificationCenter } from "./components/NotificationCenter";
import { WindowControls } from "./components/WindowControls";
import { WhatsNewModal } from "./components/WhatsNewModal";
import { DropZone } from "./components/DropZone";
import { HeaderDownloads } from "./components/HeaderDownloads";
import { CommandPalette } from "./components/CommandPalette";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { Icon } from "./components/Icon";
import { getCurrentWindow, ProgressBarStatus } from "@tauri-apps/api/window";
import { tauriHandle } from "./lib/tauri";
import { SessionWarningModal } from "./components/SessionWarningModal";
import { VariantPickerModal } from "./components/VariantPickerModal";
import { extractUrlFromDeepLink } from "./lib/deepLink";
import { enqueueDownload } from "./lib/queue";
import { STARTUP_CHECK_DELAY_MS, checkForAppUpdate } from "./lib/update";
import { usePreference } from "./hooks/usePreference";
import { Library } from "./pages/Library";
import { Browse } from "./pages/Browse";
import { Settings } from "./pages/Settings";
import { useMods } from "./hooks/useMods";
import { useDownload } from "./hooks/useDownload";
import { selectActiveJobCount } from "./store/modStore";

/** How often to re-check whether the game is running, while focused. */
const GAME_POLL_MS = 4000;

/** True when the keystroke landed in a field the user is typing into. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function AppShell() {
  const [isPitWallOpen, setIsPitWallOpen] = useState(false);
  const [deepLinkUrl, setDeepLinkUrl] = useState<string | null>(null);
  const [isAuthWarningOpen, setIsAuthWarningOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = usePreference("sidebar-collapsed", false);

  const navigate = useNavigate();
  const location = useLocation();
  const activeJobCount = useModStore(selectActiveJobCount);
  const gamePathValid = useModStore((s) => s.gamePathValid);
  const gameRunning = useModStore((s) => s.gameRunning);
  const { conflicts, loadMods } = useMods();

  useDownload();

  const toggleSidebar = useCallback(
    () => setSidebarCollapsed(!sidebarCollapsed),
    [sidebarCollapsed, setSidebarCollapsed]
  );

  const openDownloads = useCallback(() => setIsPitWallOpen(true), []);

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

      // Only meaningful once a real folder is known, and the backend records
      // the stamp silently the first time so this never fires on a fresh
      // install — or on everyone's first launch of this version.
      if (valid) {
        const patched = await invoke<boolean>("check_game_patched").catch(() => false);
        // Surfaced by the library's notice centre rather than another bar
        // here: it is advice about mods, and its action is a mod action.
        if (patched) useModStore.getState().setGamePatched(true);
      }
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

  // Mirror the queue onto the taskbar icon, so a long download can be watched
  // without keeping the window in front.
  useEffect(() => {
    tauriHandle(getCurrentWindow)
      ?.setProgressBar({
        status: activeJobCount > 0 ? ProgressBarStatus.Indeterminate : ProgressBarStatus.None,
      })
      .catch(() => {
        // The platform has no taskbar progress.
      });
  }, [activeJobCount]);

  // Watch for the game being open.
  //
  // Every mod operation renames a .pak the game memory-maps while it runs, so
  // the backend refuses them outright; this is what lets the interface say so
  // beforehand instead of surfacing a failure. Polled rather than pushed
  // because nothing notifies us when a process starts, and only while the
  // window is focused — there is nothing to warn about behind another window,
  // and it keeps the scan off the CPU during a race.
  useEffect(() => {
    let disposed = false;

    const check = () => {
      invoke<boolean>("game_is_running")
        .then((running) => {
          if (!disposed) useModStore.getState().setGameRunning(running);
        })
        .catch(() => {
          // No Tauri runtime: the guard simply does not apply.
        });
    };

    check();
    let timer = window.setInterval(check, GAME_POLL_MS);

    const onFocus = () => {
      check();
      window.clearInterval(timer);
      timer = window.setInterval(check, GAME_POLL_MS);
    };
    const onBlur = () => window.clearInterval(timer);

    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // ─── Keyboard shortcuts ─────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // "?" is the one shortcut without a modifier, so it must not fire while
      // the user is writing a search query that happens to contain one — nor
      // stack a second dialog on top of one that is already open.
      if (e.key === "?" && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        e.preventDefault();
        setIsShortcutsOpen(true);
        return;
      }

      if (!e.ctrlKey || e.altKey) return;

      // Shift is only part of Ctrl+Shift+... combos we do not use.
      if (e.shiftKey) return;

      const shortcuts: Record<string, () => void> = {
        k: () => setIsPaletteOpen((open) => !open),
        f: () => window.dispatchEvent(new CustomEvent("app:focus-search")),
        j: () => setIsPitWallOpen((open) => !open),
        b: toggleSidebar,
        r: () => {
          navigate("/browse");
          setTimeout(() => window.dispatchEvent(new CustomEvent("app:sync-catalog")), 60);
        },
        ",": () => navigate("/settings"),
        "1": () => navigate("/library"),
        "2": () => navigate("/browse"),
        "3": () => navigate("/settings"),
      };

      const action = shortcuts[e.key.toLowerCase()];
      if (action) {
        e.preventDefault();
        action();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, toggleSidebar]);

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

  const paletteHooks = useMemo(
    () => ({ onOpenDownloads: openDownloads, onToggleSidebar: toggleSidebar, reloadMods: loadMods }),
    [openDownloads, toggleSidebar, loadMods]
  );

  return (
    <div className="relative flex h-screen overflow-hidden">
      <div className="app-backdrop" />

      <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />

      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        <header
          data-tauri-drag-region
          className="titlebar flex flex-shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-bg-secondary/60 py-2 pl-5 pr-0"
        >
          <div data-tauri-drag-region className="flex min-w-0 items-center gap-3">
            <span className="font-display text-sm font-bold tracking-wide text-text-primary">
              F1 MANAGER 24
            </span>
            <span className="h-3.5 w-px bg-border" />
            <span className="truncate text-sm text-text-muted">Mod Manager</span>
          </div>

          <div className="no-drag flex min-w-0 items-center gap-2 pr-0">
            <button
              onClick={() => setIsPaletteOpen(true)}
              className="hidden h-9 items-center gap-2 rounded-xl border border-border bg-surface/60 px-3 text-xs text-text-muted transition-colors duration-fast hover:border-border-strong hover:bg-surface-raised hover:text-text-secondary lg:flex"
              title="Search mods and run commands"
            >
              <Icon name="search" size={14} />
              <span>Search</span>
              <span className="kbd ml-1">Ctrl</span>
              <span className="kbd">K</span>
            </button>

            <NotificationCenter />

            <HeaderDownloads onOpen={openDownloads} />

            <span className="mx-1 h-5 w-px bg-border" />

            <PlayButton conflicts={conflicts} />

            <WindowControls />
          </div>
        </header>

        {gameRunning && (
          <div className="flex flex-shrink-0 items-center gap-2 border-b border-info/20 bg-info/10 px-5 py-2 text-xs text-info">
            <Icon name="warning" size={16} />
            F1 Manager 24 is running — installing, enabling and reordering are paused until you
            close it, because the game keeps its mod files locked.
          </div>
        )}

        {!gamePathValid && (
          <NavLink
            to="/settings"
            className="flex flex-shrink-0 items-center gap-2 border-b border-warning/20 bg-warning/10 px-5 py-2 text-xs text-warning transition-colors hover:bg-warning/15"
          >
            <Icon name="warning-solid" size={16} />
            Game folder not set or invalid — mods cannot be installed. Open Settings to fix it.
          </NavLink>
        )}

        {/* Keyed by path so switching tabs fades the new page in instead of
            swapping it in place. The pages already remount on navigation, so
            this costs nothing beyond the animation itself. */}
        <main key={location.pathname} className="flex-1 animate-fade-in overflow-hidden">
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

      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        hooks={paletteHooks}
      />

      <ShortcutsModal isOpen={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} />

      <InstallPromptModal
        isOpen={deepLinkUrl !== null}
        url={deepLinkUrl}
        onClose={() => setDeepLinkUrl(null)}
        onConfirm={handleConfirmDeepLink}
      />

      <SessionWarningModal isOpen={isAuthWarningOpen} onClose={() => setIsAuthWarningOpen(false)} />

      <VariantPickerModal />

      <WhatsNewModal />

      <DropZone />
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
