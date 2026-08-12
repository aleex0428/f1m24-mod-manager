#!/usr/bin/env node
/**
 * Local release: build, sign, write latest.json and open a draft GitHub release.
 *
 * This does exactly what .github/workflows/release.yml does, from your own
 * machine — for when GitHub Actions is unavailable.
 *
 *   npm run release            build + publish a draft release
 *   npm run release -- --dry-run   run every check, build nothing
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DRY_RUN = process.argv.includes("--dry-run");
const KEY_PATH = join(homedir(), ".tauri", "f1m24-updater.key");
const BUNDLE_DIR = join("src-tauri", "target", "release", "bundle", "nsis");

const fail = (message, hint) => {
  console.error(`\n✖ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
};

const step = (message) => console.log(`\n▸ ${message}`);

// ─── 1. Versions must agree everywhere ──────────────────────
const tauriConf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const cargo = readFileSync("src-tauri/Cargo.toml", "utf8");
const cargoVersion = cargo.match(/^version\s*=\s*"(.+?)"/m)?.[1];

const version = tauriConf.version;

if (pkg.version !== version || cargoVersion !== version) {
  fail(
    `Version mismatch: tauri.conf.json=${version}, package.json=${pkg.version}, Cargo.toml=${cargoVersion}`,
    "All three must match before releasing."
  );
}
console.log(`Releasing version ${version}`);

// ─── 2. Prerequisites ───────────────────────────────────────
if (!existsSync(KEY_PATH)) {
  fail(
    `Signing key not found at ${KEY_PATH}`,
    "Without it the update cannot be signed and no user could install it."
  );
}

try {
  execSync("gh auth status", { stdio: "ignore" });
} catch {
  fail("GitHub CLI is not authenticated", "Run: gh auth login");
}

const tag = `v${version}`;
try {
  execSync(`gh release view ${tag}`, { stdio: "ignore" });
  fail(
    `A release for ${tag} already exists`,
    "Bump the version, or delete the existing release first."
  );
} catch {
  // Not found is exactly what we want.
}

const repo = execSync("gh repo view --json nameWithOwner --jq .nameWithOwner", {
  encoding: "utf8",
}).trim();

const endpoint = tauriConf.plugins?.updater?.endpoints?.[0] ?? "";
if (!endpoint.includes(repo)) {
  fail(
    `The updater endpoint does not point at ${repo}`,
    `Currently: ${endpoint}`
  );
}

if (DRY_RUN) {
  console.log("\n✔ All checks passed. Nothing was built (--dry-run).");
  process.exit(0);
}

// ─── 3. Build and sign ──────────────────────────────────────
step("Building and signing (this takes a few minutes)…");
execSync("npm run tauri build", {
  stdio: "inherit",
  env: {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: readFileSync(KEY_PATH, "utf8"),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
  },
});

const installer = `F1M24 Mod Manager_${version}_x64-setup.exe`;
const installerPath = join(BUNDLE_DIR, installer);
const signaturePath = `${installerPath}.sig`;

for (const path of [installerPath, signaturePath]) {
  if (!existsSync(path)) fail(`Expected build output is missing: ${path}`);
}

// ─── 4. latest.json ─────────────────────────────────────────
step("Writing latest.json");

// GitHub replaces spaces in asset names with dots. If this does not match the
// uploaded asset byte for byte, the updater silently downloads nothing.
const assetName = installer.replace(/ /g, ".");

const latest = {
  version,
  notes: `F1M24 Mod Manager ${version}`,
  pub_date: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  platforms: {
    "windows-x86_64": {
      signature: readFileSync(signaturePath, "utf8").trim(),
      url: `https://github.com/${repo}/releases/download/${tag}/${assetName}`,
    },
  },
};

const latestPath = join(BUNDLE_DIR, "latest.json");
writeFileSync(latestPath, `${JSON.stringify(latest, null, 2)}\n`);

// ─── 5. Draft release ───────────────────────────────────────
step("Creating the draft release");
execFileSync(
  "gh",
  [
    "release",
    "create",
    tag,
    "--draft",
    "--title",
    `F1M24 Mod Manager ${version}`,
    "--notes",
    [
      "Download the `.exe` below and run it.",
      "",
      "Windows SmartScreen will warn that the publisher is unknown because the",
      "installer is not code-signed: **More info → Run anyway**.",
    ].join("\n"),
    installerPath,
    signaturePath,
    latestPath,
  ],
  { stdio: "inherit" }
);

console.log(`
✔ Draft release ${tag} created.

  Review it, then publish with:
    gh release edit ${tag} --draft=false

  Until it is published, /releases/latest/download/latest.json does not
  resolve and no one receives the update.
`);
