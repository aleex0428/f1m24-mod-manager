import { invoke } from "@tauri-apps/api/core";
import toast from "react-hot-toast";
import { useModStore } from "../store/modStore";

/**
 * Open the Overtake.gg sign-in window.
 *
 * Success is reported by the backend through the `auth-linked` / `auth-status`
 * events (a cookie watcher, not a navigation guess), so there is nothing to
 * await here beyond the window opening.
 */
export async function linkOvertakeAccount(): Promise<void> {
  try {
    await invoke("open_overtake_login");
    toast("Sign in on the window that just opened — tick “Stay signed in”.", {
      icon: "🔑",
      duration: 6000,
      id: "overtake-login",
    });
  } catch (err) {
    toast.error(String(err));
  }
}

/** Ask the backend to re-check the stored session. */
export async function verifyOvertakeSession(): Promise<boolean> {
  try {
    const linked = await invoke<boolean>("verify_session");
    useModStore.getState().setLoggedIn(linked);
    if (linked) {
      toast.success("Session is valid");
    } else {
      toast("No active session — sign in again", { icon: "⚠️" });
    }
    return linked;
  } catch (err) {
    toast.error(String(err));
    return false;
  }
}

/** Sign out and drop the webview cookies. */
export async function unlinkOvertakeAccount(): Promise<void> {
  try {
    await invoke("clear_session_cookie");
    useModStore.getState().setLoggedIn(false);
    toast.success("Account unlinked");
  } catch (err) {
    toast.error(String(err));
  }
}
