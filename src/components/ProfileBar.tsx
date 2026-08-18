import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import toast from "react-hot-toast";

import { Icon } from "./Icon";
import { Modal, ModalHeader } from "./Modal";
import { useModStore } from "../store/modStore";
import type { ApplyReport, Profile } from "../types";

/**
 * Switching between saved sets of mods.
 *
 * The one thing worth being loud about: a profile is the *complete* list of
 * what should be active, so applying one disables everything it does not name.
 * That is what makes it a state you can return to rather than a pile of
 * suggestions — but it is also genuinely surprising the first time, so the
 * first apply asks, and the result says exactly what changed.
 */
export function ProfileBar({ onApplied }: { onApplied: () => Promise<void> | void }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [pendingApply, setPendingApply] = useState<Profile | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const gameRunning = useModStore((s) => s.gameRunning);
  const modCount = useModStore((s) => s.mods.length);

  const refresh = useCallback(async () => {
    const [list, active] = await Promise.all([
      invoke<Profile[]>("list_profiles").catch(() => [] as Profile[]),
      invoke<string | null>("get_active_profile").catch(() => null),
    ]);
    setProfiles(list);
    setActiveId(active);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const apply = useCallback(
    async (profile: Profile) => {
      setBusy(true);
      const toastId = toast.loading(`Switching to ${profile.name}…`);
      try {
        const report = await invoke<ApplyReport>("apply_profile", { id: profile.id });
        await onApplied();
        setActiveId(profile.id);

        const parts: string[] = [];
        if (report.enabled) parts.push(`${report.enabled} enabled`);
        if (report.disabled) parts.push(`${report.disabled} disabled`);
        if (report.missing) parts.push(`${report.missing} no longer installed`);

        toast.success(
          parts.length > 0 ? `${profile.name} — ${parts.join(", ")}` : `${profile.name} — nothing to change`,
          { id: toastId }
        );
      } catch (err) {
        toast.error(String(err), { id: toastId });
      } finally {
        setBusy(false);
        setPendingApply(null);
      }
    },
    [onApplied]
  );

  const handleSelect = useCallback(
    (profile: Profile) => {
      if (profile.id === activeId) return;
      // Confirm only when the profile would actually turn something off.
      const disables = useModStore
        .getState()
        .mods.some((m) => m.enabled && !profile.enabledModIds.includes(m.id));
      if (disables) setPendingApply(profile);
      else apply(profile);
    },
    [activeId, apply]
  );

  const handleSave = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await invoke<Profile>("save_profile", { name });
      await refresh();
      setIsSaveOpen(false);
      setNewName("");
      toast.success(`Saved “${name}”`);
    } catch (err) {
      toast.error(String(err));
    }
  }, [newName, refresh]);

  const handleOverwrite = useCallback(
    async (profile: Profile) => {
      try {
        await invoke("update_profile", { id: profile.id });
        await refresh();
        toast.success(`${profile.name} now matches your library`);
      } catch (err) {
        toast.error(String(err));
      }
    },
    [refresh]
  );

  const handleDelete = useCallback(
    async (profile: Profile) => {
      try {
        await invoke("delete_profile", { id: profile.id });
        await refresh();
        toast.success(`Deleted “${profile.name}”`);
      } catch (err) {
        toast.error(String(err));
      }
    },
    [refresh]
  );

  const active = profiles.find((p) => p.id === activeId);

  return (
    <>
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-border/70 px-6 py-2.5">
        <span className="text-2xs font-semibold uppercase tracking-wider text-text-muted">
          Profile
        </span>

        {profiles.length === 0 ? (
          <span className="text-xs text-text-muted">
            None yet — save your current setup to switch back to it later.
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                onClick={() => handleSelect(profile)}
                disabled={busy || gameRunning}
                aria-pressed={profile.id === activeId}
                title={
                  gameRunning
                    ? "Close F1 Manager 24 first — its mod files are locked"
                    : `${profile.enabledModIds.length} mods active in this profile`
                }
                className={`filter-chip ${profile.id === activeId ? "filter-chip-active" : ""}`}
              >
                {profile.id === activeId && <Icon name="check" size={12} strokeWidth={2.4} />}
                {profile.name}
                <span className="font-mono text-2xs opacity-70">
                  {profile.enabledModIds.length}
                </span>
              </button>
            ))}
          </div>
        )}

        <span className="ml-auto flex items-center gap-1">
          {active && (
            <button
              onClick={() => handleOverwrite(active)}
              className="btn-subtle !py-1.5 !text-xs"
              title={`Make “${active.name}” match the library as it is now`}
            >
              Update
            </button>
          )}
          <button
            onClick={() => {
              setIsSaveOpen(true);
              setTimeout(() => nameRef.current?.focus(), 0);
            }}
            disabled={modCount === 0}
            className="btn-subtle !py-1.5 !text-xs"
            title="Save the current set of active mods as a profile"
          >
            <Icon name="plus" size={13} strokeWidth={2} />
            Save as…
          </button>
          {profiles.length > 0 && (
            <button
              onClick={() => setIsManageOpen(true)}
              className="btn-icon-sm"
              title="Manage profiles"
              aria-label="Manage profiles"
            >
              <Icon name="settings" size={14} />
            </button>
          )}
        </span>
      </div>

      {/* ── Save ───────────────────────────────────────────── */}
      <Modal
        isOpen={isSaveOpen}
        onClose={() => setIsSaveOpen(false)}
        title="Save profile"
        size="max-w-md"
      >
        <div className="p-6">
          <h2 className="font-display text-lg font-bold text-text-primary">Save this setup</h2>
          <p className="mb-4 mt-1 text-sm text-text-muted">
            Stores which mods are active and the order they load in, so you can come back to
            exactly this later.
          </p>
          <input
            ref={nameRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
            placeholder="Season 2026"
            aria-label="Profile name"
            className="input"
          />
          <div className="mt-5 flex gap-3">
            <button onClick={() => setIsSaveOpen(false)} className="btn-ghost flex-1">
              Cancel
            </button>
            <button onClick={handleSave} disabled={!newName.trim()} className="btn-primary flex-1">
              Save profile
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Confirm a switch that disables things ──────────── */}
      <Modal
        isOpen={pendingApply !== null}
        onClose={() => setPendingApply(null)}
        title="Switch profile"
        size="max-w-md"
      >
        {pendingApply && (
          <div className="p-6">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-warning/20 bg-warning/10 text-warning">
                <Icon name="warning-solid" size={20} />
              </span>
              <div>
                <h2 className="font-display font-bold text-text-primary">
                  Switch to “{pendingApply.name}”?
                </h2>
                <p className="text-sm text-text-secondary">
                  {pendingApply.enabledModIds.length} mods will be active.
                </p>
              </div>
            </div>

            <p className="mb-5 rounded-xl border border-border-subtle bg-bg-elevated p-3 text-xs leading-relaxed text-text-muted">
              A profile is the complete list of what should be on, so anything it does not include
              gets disabled — including mods you have installed since it was saved. Nothing is
              deleted; you can switch back or turn them on again.
            </p>

            <div className="flex gap-3">
              <button onClick={() => setPendingApply(null)} className="btn-ghost flex-1">
                Cancel
              </button>
              <button onClick={() => apply(pendingApply)} className="btn-primary flex-1">
                Switch
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Manage ─────────────────────────────────────────── */}
      <Modal
        isOpen={isManageOpen}
        onClose={() => setIsManageOpen(false)}
        title="Manage profiles"
        size="max-w-lg"
      >
        <ModalHeader
          title="Profiles"
          description="Rename, refresh or remove. Deleting a profile never touches your mods."
          onClose={() => setIsManageOpen(false)}
        />
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {profiles.map((profile) => (
            <ProfileRow
              key={profile.id}
              profile={profile}
              isActive={profile.id === activeId}
              onRename={async (name) => {
                try {
                  await invoke("rename_profile", { id: profile.id, name });
                  await refresh();
                } catch (err) {
                  toast.error(String(err));
                }
              }}
              onOverwrite={() => handleOverwrite(profile)}
              onDelete={() => handleDelete(profile)}
            />
          ))}
        </div>
      </Modal>
    </>
  );
}

function ProfileRow({
  profile,
  isActive,
  onRename,
  onOverwrite,
  onDelete,
}: {
  profile: Profile;
  isActive: boolean;
  onRename: (name: string) => void;
  onOverwrite: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => setName(profile.name), [profile.name]);

  return (
    <div className="panel flex items-center gap-3 p-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (name.trim() && name !== profile.name) onRename(name.trim());
          else setName(profile.name);
        }}
        aria-label={`Name of ${profile.name}`}
        className="input !w-auto flex-1 !py-1.5 !text-sm"
      />

      <span className="flex-shrink-0 font-mono text-2xs text-text-muted">
        {profile.enabledModIds.length} on
      </span>

      {isActive && (
        <span className="chip flex-shrink-0 border-f1red/30 bg-f1red/[0.12] text-f1red">Active</span>
      )}

      <button onClick={onOverwrite} className="btn-subtle !py-1.5 !text-xs" title="Overwrite with the current library">
        Update
      </button>

      <button
        onClick={() => (confirming ? onDelete() : setConfirming(true))}
        onBlur={() => setConfirming(false)}
        className={`btn-icon-sm ${confirming ? "bg-danger/15 text-danger" : "hover:bg-danger/10 hover:text-danger"}`}
        title={confirming ? "Click again to delete" : "Delete this profile"}
        aria-label={`Delete ${profile.name}`}
      >
        <Icon name={confirming ? "check" : "trash"} size={14} />
      </button>
    </div>
  );
}
