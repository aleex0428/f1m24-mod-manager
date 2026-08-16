import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import toast from "react-hot-toast";

import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { useModStore } from "../store/modStore";
import { formatDate } from "../lib/format";
import { linkOvertakeAccount, unlinkOvertakeAccount, verifyOvertakeSession } from "../lib/auth";
import { checkForAppUpdate, installAppUpdate } from "../lib/update";
import { Icon, type IconName } from "../components/Icon";
import type { CatalogStats } from "../types";

/** Settings persisted through the Rust `save_setting` command. */
const PREF_CLOSE_TO_TRAY = "close_to_tray";
const PREF_NOTIFICATIONS = "notifications_enabled";
const PREF_KEEP_ARCHIVES = "keep_archives";

/** The page's sections, in the order they appear. Drives the index. */
const SECTIONS: { id: string; label: string; icon: IconName }[] = [
  { id: "game", label: "Game", icon: "play" },
  { id: "downloads", label: "Downloads", icon: "download" },
  { id: "account", label: "Account", icon: "link" },
  { id: "catalog", label: "Catalogue", icon: "browse" },
  { id: "behaviour", label: "Behaviour", icon: "settings" },
  { id: "about", label: "About", icon: "cube" },
];

export function Settings() {
  const gamePath = useModStore((s) => s.gamePath);
  const gamePathValid = useModStore((s) => s.gamePathValid);
  const isLoggedIn = useModStore((s) => s.isLoggedIn);
  const appVersion = useModStore((s) => s.appVersion);

  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [closeToTray, setCloseToTray] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [keepArchives, setKeepArchives] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [modsPath, setModsPath] = useState("");
  const [releasesUrl, setReleasesUrl] = useState("");
  const [archivesPath, setArchivesPath] = useState("");
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const update = useModStore((s) => s.appUpdate);

  useEffect(() => {
    invoke<CatalogStats>("get_catalog_stats").then(setStats).catch(() => {});
    invoke<string>("get_archives_path").then(setArchivesPath).catch(() => {});
    invoke<string>("get_releases_url").then(setReleasesUrl).catch(() => {});

    invoke<string>("get_setting", { key: PREF_CLOSE_TO_TRAY })
      .then((v) => setCloseToTray(v !== "false"))
      .catch(() => {});

    invoke<string>("get_setting", { key: PREF_NOTIFICATIONS })
      .then((v) => setNotifications(v !== "false"))
      .catch(() => {});

    invoke<string>("get_setting", { key: PREF_KEEP_ARCHIVES })
      .then((v) => setKeepArchives(v !== "false"))
      .catch(() => {});
  }, []);

  // The real path comes from the backend so it always matches what Explorer
  // is given (separators included).
  useEffect(() => {
    invoke<string>("get_mods_dir_path").then(setModsPath).catch(() => setModsPath(""));
  }, [gamePath]);

  // Highlight the section currently under the top of the viewport. The
  // rootMargin pulls the trigger line down from the very top so a section
  // becomes "current" as it settles into view, not as its last pixel leaves.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveSection(visible.target.id);
      },
      { root, rootMargin: "-12% 0px -70% 0px", threshold: 0 }
    );

    for (const section of SECTIONS) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const savePref = useCallback(async (key: string, value: boolean) => {
    try {
      await invoke("save_setting", { key, value: value ? "true" : "false" });
    } catch (err) {
      toast.error(`Could not save the setting: ${err}`);
    }
  }, []);

  const refreshPathState = useCallback(async (path: string) => {
    const store = useModStore.getState();
    store.setGamePath(path);
    const valid = await invoke<boolean>("validate_game_path").catch(() => false);
    store.setGamePathValid(valid);
  }, []);

  const handleSelectFolder = useCallback(async () => {
    try {
      const path = await invoke<string>("select_game_path_dialog");
      await refreshPathState(path);
      toast.success("Game folder saved");
    } catch (err) {
      const message = String(err);
      if (!message.includes("No folder selected") && !message.includes("cancelled")) {
        toast.error(message);
      }
    }
  }, [refreshPathState]);

  const handleAutoDetect = useCallback(async () => {
    setDetecting(true);
    try {
      const path = await invoke<string>("detect_game_path");
      await invoke("save_setting", { key: "game_path", value: path });
      await refreshPathState(path);
      toast.success("Game folder detected");
    } catch {
      toast.error("Could not find F1 Manager 24 automatically — pick the folder manually");
    } finally {
      setDetecting(false);
    }
  }, [refreshPathState]);

  const handleOpenModsFolder = useCallback(async () => {
    try {
      await invoke("open_mods_folder");
    } catch (err) {
      toast.error(String(err));
    }
  }, []);

  const handleOpenArchives = useCallback(async () => {
    try {
      await invoke("open_archives_folder");
    } catch (err) {
      toast.error(String(err));
    }
  }, []);

  const handleLogout = useCallback(async () => {
    await unlinkOvertakeAccount();
  }, []);

  const handleVerify = useCallback(async () => {
    setVerifying(true);
    await verifyOvertakeSession();
    setVerifying(false);
  }, []);

  const jumpTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveSection(id);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-shrink-0 border-b border-border/70 px-6 py-4">
        <h1 className="section-title">Settings</h1>
        <p className="mt-0.5 text-sm text-text-muted">Paths, account and app behaviour</p>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-smooth">
        <div className="mx-auto flex max-w-4xl gap-8 px-6 py-6">
          {/* Section index. Settings grew past the point where a single long
              scroll tells you what is in it. */}
          <nav
            aria-label="Settings sections"
            className="sticky top-0 hidden h-fit w-40 flex-shrink-0 space-y-0.5 lg:block"
          >
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                onClick={() => jumpTo(section.id)}
                aria-current={activeSection === section.id ? "true" : undefined}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-fast ${
                  activeSection === section.id
                    ? "bg-f1red/10 font-medium text-text-primary"
                    : "text-text-muted hover:bg-surface/70 hover:text-text-secondary"
                }`}
              >
                <Icon
                  name={section.icon}
                  size={15}
                  className={activeSection === section.id ? "text-f1red" : ""}
                />
                {section.label}
              </button>
            ))}
          </nav>

          <div className="min-w-0 flex-1 space-y-4">
            {/* Game path */}
            <section id="game" className="panel scroll-mt-4 p-5">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display font-bold text-text-primary">Game installation</h2>
                  <p className="mt-0.5 text-sm text-text-muted">
                    The folder that contains <span className="font-mono">F1Manager24.exe</span>.
                  </p>
                </div>
                <span
                  className={`chip flex-shrink-0 ${
                    gamePathValid
                      ? "border-success/25 bg-success/10 text-success"
                      : "border-warning/25 bg-warning/10 text-warning"
                  }`}
                >
                  {gamePathValid ? "Verified" : "Not found"}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                <input
                  value={gamePath}
                  readOnly
                  placeholder="C:\Program Files (x86)\Steam\steamapps\common\F1 Manager 2024"
                  className="input min-w-[16rem] flex-1 font-mono !text-xs text-text-secondary"
                />
                <button onClick={handleAutoDetect} disabled={detecting} className="btn-ghost !py-2.5">
                  {detecting ? "Detecting…" : "Auto-detect"}
                </button>
                <button onClick={handleSelectFolder} className="btn-primary !py-2.5">
                  Choose folder
                </button>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border-subtle pt-4">
                <div className="min-w-0 flex-1">
                  <p className="text-2xs uppercase tracking-wider text-text-muted">
                    Mods are installed here
                  </p>
                  <p className="truncate font-mono text-xs text-text-secondary" title={modsPath}>
                    {modsPath || "Set the game folder first"}
                  </p>
                </div>
                <button
                  onClick={handleOpenModsFolder}
                  disabled={!modsPath}
                  className="btn-ghost !py-2 !text-xs"
                >
                  <Icon name="folder" size={14} />
                  Open folder
                </button>
              </div>
            </section>

            {/* Downloads */}
            <section id="downloads" className="panel scroll-mt-4 p-5">
              <h2 className="font-display font-bold text-text-primary">Downloaded files</h2>
              <p className="mb-4 mt-0.5 text-sm text-text-muted">
                Archives (.zip / .rar / .7z) are downloaded to a temporary folder, unpacked, and
                only the .pak files are copied into the game. A copy of each archive is kept here so
                you can reinstall without downloading again.
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <p
                  className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary"
                  title={archivesPath}
                >
                  {archivesPath || "—"}
                </p>
                <button onClick={handleOpenArchives} className="btn-ghost !py-2 !text-xs">
                  <Icon name="folder" size={14} />
                  Open folder
                </button>
              </div>

              <div className="mt-4 flex items-center justify-between gap-4 border-t border-border-subtle pt-4">
                <div>
                  <h3 className="font-medium text-text-primary">Keep downloaded archives</h3>
                  <p className="mt-0.5 text-sm text-text-muted">
                    Turn off to delete each archive right after installing it.
                  </p>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    aria-label="Keep downloaded archives"
                    checked={keepArchives}
                    onChange={(e) => {
                      setKeepArchives(e.target.checked);
                      savePref(PREF_KEEP_ARCHIVES, e.target.checked);
                    }}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
            </section>

            {/* Account */}
            <section id="account" className="panel scroll-mt-4 p-5">
              <h2 className="font-display font-bold text-text-primary">Overtake.gg account</h2>
              <p className="mb-4 mt-0.5 text-sm text-text-muted">
                A signed-in browser session is what lets downloads pass Cloudflare.
              </p>

              {isLoggedIn ? (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-xl border border-success/20 bg-success/5 px-3 py-2.5">
                    <span className="h-2 w-2 rounded-full bg-success" />
                    <span className="text-sm font-medium text-success">Account linked</span>
                  </div>
                  <button onClick={handleVerify} disabled={verifying} className="btn-ghost !py-2.5">
                    {verifying ? "Checking…" : "Verify"}
                  </button>
                  <button onClick={handleLogout} className="btn-danger !py-2.5">
                    Unlink
                  </button>
                </div>
              ) : (
                <>
                  <button onClick={linkOvertakeAccount} className="btn-primary w-full !py-3">
                    <Icon name="link" size={16} />
                    Link Overtake.gg account
                  </button>
                  <button
                    onClick={handleVerify}
                    disabled={verifying}
                    className="btn-subtle mx-auto mt-1 !text-xs"
                  >
                    {verifying ? "Checking…" : "Already signed in? Re-check"}
                  </button>
                </>
              )}

              <ul className="mt-4 space-y-1.5 border-t border-border-subtle pt-4 text-xs text-text-muted">
                <li>
                  A real browser window opens on overtake.gg. The app never sees or stores your
                  password — only the browser session cookie stays on this PC.
                </li>
                <li>
                  Tick <span className="text-text-secondary">“Stay signed in”</span> on the login
                  form. Without it the session is dropped when you close the app.
                </li>
              </ul>
            </section>

            {/* Catalog */}
            <section id="catalog" className="panel scroll-mt-4 p-5">
              <h2 className="font-display font-bold text-text-primary">Mod catalog</h2>
              <p className="mb-4 mt-0.5 text-sm text-text-muted">
                The Browse tab reads from a local copy of the Overtake.gg listing.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Mods cached" value={stats ? String(stats.count) : "—"} />
                <Stat
                  label="Last sync"
                  value={stats?.lastSync ? formatDate(stats.lastSync) : "Never"}
                />
              </div>
            </section>

            {/* Behaviour */}
            <section id="behaviour" className="panel scroll-mt-4 divide-y divide-border-subtle">
              <PreferenceRow
                title="Keep running in the tray"
                description="Closing the window hides the app instead of quitting it."
                checked={closeToTray}
                onChange={(v) => {
                  setCloseToTray(v);
                  savePref(PREF_CLOSE_TO_TRAY, v);
                }}
              />
              <PreferenceRow
                title="Desktop notifications"
                description="Get a Windows toast when a mod finishes installing."
                checked={notifications}
                onChange={(v) => {
                  setNotifications(v);
                  savePref(PREF_NOTIFICATIONS, v);
                }}
              />
            </section>

            {/* About & updates */}
            <section id="about" className="panel scroll-mt-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="font-display font-bold text-text-primary">F1M24 Mod Manager</h2>
                  <p className="mt-0.5 font-mono text-xs text-text-muted">version {appVersion}</p>
                </div>

                <div className="flex items-center gap-2">
                  {update.stage === "available" ? (
                    <button onClick={() => installAppUpdate()} className="btn-primary !py-2 !text-xs">
                      Install {update.version}
                    </button>
                  ) : (
                    <button
                      onClick={() => checkForAppUpdate(false)}
                      disabled={update.stage === "checking" || update.stage === "downloading"}
                      className="btn-ghost !py-2 !text-xs"
                    >
                      {update.stage === "checking" ? "Checking…" : "Check for updates"}
                    </button>
                  )}
                  <button
                    onClick={() => invoke("quit_app").catch(() => {})}
                    className="btn-ghost !py-2 !text-xs"
                  >
                    Quit app
                  </button>
                </div>
              </div>

              {update.stage === "available" && update.notes && (
                <p className="selectable mt-3 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border-subtle bg-bg-elevated p-3 text-xs text-text-secondary">
                  {update.notes}
                </p>
              )}

              {(update.stage === "downloading" || update.stage === "ready") && (
                <div className="mt-3">
                  <p className="mb-1.5 text-xs text-text-secondary">
                    {update.stage === "ready"
                      ? "Update installed — restarting…"
                      : `Downloading ${update.version}…`}
                  </p>
                  <div className="progress-track">
                    {update.progress === undefined && update.stage === "downloading" ? (
                      <div className="progress-indeterminate" />
                    ) : (
                      <div className="progress-fill" style={{ width: `${update.progress ?? 100}%` }} />
                    )}
                  </div>
                </div>
              )}

              {update.stage === "error" && (
                <div className="mt-3 rounded-xl border border-danger/25 bg-danger/10 p-3">
                  <p className="text-xs text-danger">
                    Could not reach the update server. Your copy still works — download the newest
                    version manually if you think you are behind.
                  </p>
                  {update.error && (
                    <p className="selectable mt-1 font-mono text-2xs text-danger/70">
                      {update.error}
                    </p>
                  )}
                  {releasesUrl && (
                    <button
                      onClick={() => shellOpen(releasesUrl).catch(() => {})}
                      className="btn-ghost mt-2 !py-1.5 !text-xs border-danger/30 text-danger"
                    >
                      <Icon name="external" size={14} />
                      Open the downloads page
                    </button>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-elevated px-4 py-3">
      <p className="text-2xs uppercase tracking-wider text-text-muted">{label}</p>
      <p className="mt-1 font-display text-lg font-bold text-text-primary">{value}</p>
    </div>
  );
}

function PreferenceRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-5">
      <div>
        <h3 className="font-medium text-text-primary">{title}</h3>
        <p className="mt-0.5 text-sm text-text-muted">{description}</p>
      </div>
      <label className="toggle-switch">
        <input
          type="checkbox"
          aria-label={title}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="toggle-slider" />
      </label>
    </div>
  );
}
