import toast from "react-hot-toast";
import { useModStore } from "../store/modStore";

/** Overtake mod pages expose the file at `<page>/download`. */
export function toDownloadUrl(pageUrl: string): string {
  const clean = pageUrl.trim().replace(/\/+$/, "");
  return clean.endsWith("/download") ? clean : `${clean}/download`;
}

interface EnqueueArgs {
  jobId: string;
  title: string;
  pageUrl: string;
}

/**
 * Add a mod to the download queue. Returns false when the same job is already
 * queued or running, so callers can avoid a duplicate toast.
 */
export function enqueueDownload({ jobId, title, pageUrl }: EnqueueArgs): boolean {
  const store = useModStore.getState();
  const existing = store.jobs[jobId];

  if (existing && existing.status !== "error" && existing.status !== "canceled") {
    toast(`${title} is already in the queue`, { icon: "⏱️" });
    return false;
  }

  store.upsertJob({
    jobId,
    title,
    pageUrl,
    downloadUrl: toDownloadUrl(pageUrl),
    status: "queued",
    progress: 0,
    downloadedBytes: 0,
  });

  return true;
}
