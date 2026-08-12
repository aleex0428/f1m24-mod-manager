/**
 * Resolve a Tauri handle without letting a missing runtime take the UI down.
 *
 * `getCurrentWindow()` and `getCurrentWebview()` throw *synchronously* when the
 * app is not running inside Tauri, so a `.catch()` on the promise they would
 * have returned never fires. Called straight from an effect, that throw
 * unmounts the whole tree and leaves a blank window. Window chrome and drop
 * targets are conveniences: none of them are worth the app for.
 */
export function tauriHandle<T>(resolve: () => T): T | null {
  try {
    return resolve();
  } catch {
    return null;
  }
}
