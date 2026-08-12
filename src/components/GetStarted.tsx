import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import toast from "react-hot-toast";

import { useModStore } from "../store/modStore";
import { linkOvertakeAccount } from "../lib/auth";
import type { CatalogStats } from "../types";

interface Step {
  title: string;
  description: string;
  done: boolean;
  action: string;
  onAction: () => void;
}

/**
 * First-run checklist. Nothing in the app works until the game folder is known
 * and the account is linked, so the empty library says so explicitly instead of
 * leaving the user to guess.
 */
export function GetStarted() {
  const navigate = useNavigate();
  const gamePathValid = useModStore((s) => s.gamePathValid);
  const isLoggedIn = useModStore((s) => s.isLoggedIn);
  const [catalogCount, setCatalogCount] = useState<number | null>(null);

  const refreshCatalog = useCallback(() => {
    invoke<CatalogStats>("get_catalog_stats")
      .then((stats) => setCatalogCount(stats.count))
      .catch(() => setCatalogCount(0));
  }, []);

  useEffect(() => {
    refreshCatalog();
    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen("catalog-synced", refreshCatalog)
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refreshCatalog]);

  const chooseFolder = useCallback(async () => {
    try {
      const path = await invoke<string>("select_game_path_dialog");
      const store = useModStore.getState();
      store.setGamePath(path);
      store.setGamePathValid(await invoke<boolean>("validate_game_path").catch(() => false));
      toast.success("Game folder saved");
    } catch (err) {
      const message = String(err);
      if (!message.includes("No folder selected") && !message.includes("cancelled")) {
        toast.error(message);
      }
    }
  }, []);

  const steps: Step[] = [
    {
      title: "Point to your game",
      description: "The folder that contains F1Manager24.exe.",
      done: gamePathValid,
      action: "Choose folder",
      onAction: chooseFolder,
    },
    {
      title: "Link your Overtake.gg account",
      description: "Needed to download mods past Cloudflare.",
      done: isLoggedIn,
      action: "Sign in",
      onAction: () => {
        linkOvertakeAccount();
      },
    },
    {
      title: "Sync the mod catalog",
      description: "Pulls the F1 Manager 2024 downloads list from Overtake.gg.",
      done: (catalogCount ?? 0) > 0,
      action: "Open Browse",
      onAction: () => navigate("/browse"),
    },
  ];

  const remaining = steps.filter((s) => !s.done).length;

  return (
    <div className="mx-auto w-full max-w-xl animate-fade-in">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-f1red to-f1red-dark shadow-f1">
          <svg className="h-7 w-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.6}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
        </div>
        <h3 className="font-display text-xl font-bold text-text-primary">
          {remaining === 0 ? "You're all set" : "Let's get you on track"}
        </h3>
        <p className="mt-2 text-sm text-text-muted">
          {remaining === 0
            ? "No mods installed yet — head to Browse and pick one."
            : `${remaining} step${remaining > 1 ? "s" : ""} left before you can install mods.`}
        </p>
      </div>

      <ol className="space-y-2">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className={`panel flex items-center gap-4 p-4 transition-colors ${
              step.done ? "opacity-60" : ""
            }`}
          >
            <span
              className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border font-mono text-xs font-bold ${
                step.done
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-border bg-surface-raised text-text-secondary"
              }`}
            >
              {step.done ? (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                index + 1
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-text-primary">{step.title}</p>
              <p className="mt-0.5 text-xs text-text-muted">{step.description}</p>
            </div>

            {!step.done && (
              <button onClick={step.onAction} className="btn-ghost flex-shrink-0 !py-2 !text-xs">
                {step.action}
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
