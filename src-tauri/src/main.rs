// ─── F1M24 Mod Manager — Tauri v2 ───────────────────────────────
// main.rs: Application entry point (minimal — logic lives in lib.rs)

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    f1m24_mod_manager_lib::run();
}
