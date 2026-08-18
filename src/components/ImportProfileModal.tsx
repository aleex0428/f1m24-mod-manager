import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import toast from "react-hot-toast";

import { Modal, ModalHeader } from "./Modal";
import { Icon } from "./Icon";
import { useModStore } from "../store/modStore";
import { enqueueDownload } from "../lib/queue";
import type { ImportPreview, Profile } from "../types";

/**
 * Importing someone else's profile.
 *
 * The whole flow is built around one rule: **opening a file must not change
 * anything**. The preview is read-only, the import only saves a profile, and
 * downloading and applying are separate decisions the user makes after seeing
 * the list. A file from a stranger has no business rearranging a mod folder on
 * its own.
 */
export function ImportProfileModal({
  isOpen,
  contents,
  onClose,
  onImported,
}: {
  isOpen: boolean;
  contents: string | null;
  onClose: () => void;
  onImported: (profile: Profile) => void;
}) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const gamePathValid = useModStore((s) => s.gamePathValid);
  const isLoggedIn = useModStore((s) => s.isLoggedIn);

  // Read the file whenever a new one arrives. In an effect, not during
  // render: inspecting is a side effect, and setting state from a render pass
  // is how you get an infinite loop.
  useEffect(() => {
    if (!isOpen || !contents) return;

    let disposed = false;
    setPreview(null);
    setError(null);

    invoke<ImportPreview>("preview_shared_profile", { contents })
      .then((result) => {
        if (!disposed) setPreview(result);
      })
      .catch((err) => {
        if (!disposed) setError(String(err));
      });

    return () => {
      disposed = true;
    };
  }, [isOpen, contents]);

  const handleImport = useCallback(
    async (thenQueue: boolean) => {
      if (!contents || !preview) return;
      setBusy(true);
      try {
        const profile = await invoke<Profile>("import_shared_profile", { contents });
        onImported(profile);

        if (thenQueue) {
          let queued = 0;
          for (const mod of preview.downloadable) {
            const id = mod.url.match(/\.(\d+)\/?$/)?.[1] ?? `link-${mod.url}`;
            if (enqueueDownload({ jobId: id, title: mod.title, pageUrl: mod.url })) queued += 1;
          }
          toast.success(`“${profile.name}” saved — ${queued} downloads queued`);
        } else {
          toast.success(`“${profile.name}” saved`);
        }

        setPreview(null);
        onClose();
      } catch (err) {
        toast.error(String(err));
      } finally {
        setBusy(false);
      }
    },
    [contents, preview, onImported, onClose]
  );

  const canDownload = gamePathValid && isLoggedIn;

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        setPreview(null);
        setError(null);
        onClose();
      }}
      title="Import a profile"
      size="max-w-lg"
      className="max-h-[85vh]"
    >
      <ModalHeader
        title={preview ? `“${preview.name}”` : "Import a profile"}
        description="Nothing is installed or changed until you say so."
        onClose={() => {
          setPreview(null);
          setError(null);
          onClose();
        }}
      />

      <div className="flex-1 overflow-y-auto p-5">
        {error && (
          <p role="alert" className="rounded-xl border border-danger/25 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </p>
        )}

        {preview && (
          <div className="space-y-4">
            <Group
              icon="check-circle"
              tone="text-success"
              title={`${preview.alreadyInstalled.length} already installed`}
              items={preview.alreadyInstalled}
              empty="None of these are in your library yet."
            />

            <Group
              icon="download"
              tone="text-info"
              title={`${preview.downloadable.length} to download`}
              items={preview.downloadable.map((m) => m.title)}
              empty="Nothing to fetch — you already have everything."
            />

            {preview.unavailable.length > 0 && (
              <Group
                icon="warning-solid"
                tone="text-warning"
                title={`${preview.unavailable.length} cannot be fetched`}
                items={preview.unavailable}
                empty=""
                note="These were installed from a local file by whoever exported the profile, so there is no page to download them from."
              />
            )}
          </div>
        )}
      </div>

      {preview && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-4">
          <p className="min-w-0 flex-1 text-2xs text-text-muted">
            {canDownload
              ? "The profile is saved either way; you can download later."
              : "Link your Overtake.gg account and set the game folder to download."}
          </p>
          <button onClick={() => handleImport(false)} disabled={busy} className="btn-ghost !py-2 !text-xs">
            Just save it
          </button>
          <button
            onClick={() => handleImport(true)}
            disabled={busy || !canDownload || preview.downloadable.length === 0}
            className="btn-primary !py-2 !text-xs"
          >
            <Icon name="download" size={14} />
            Save and download {preview.downloadable.length}
          </button>
        </div>
      )}
    </Modal>
  );
}

function Group({
  icon,
  tone,
  title,
  items,
  empty,
  note,
}: {
  icon: "check-circle" | "download" | "warning-solid";
  tone: string;
  title: string;
  items: string[];
  empty: string;
  note?: string;
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-text-muted">
        <Icon name={icon} size={14} className={tone} />
        {title}
      </h3>
      {items.length === 0 ? (
        empty && <p className="text-xs text-text-muted">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((name) => (
            <li
              key={name}
              className="truncate rounded-lg border border-border-subtle bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary"
              title={name}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
      {note && <p className="mt-2 text-2xs leading-relaxed text-text-muted">{note}</p>}
    </section>
  );
}
