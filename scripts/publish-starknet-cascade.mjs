#!/usr/bin/env node
/**
 * Publish the Starknet SDK cascade to npm and rewire every consumer to the published
 * versions — no workspace/local linking left behind.
 *
 * What it does, hands-off:
 *   1. Checks you are logged in to npm (`npm whoami`).
 *   2. Bumps the changed packages, sets the new packages' versions, and rewrites EVERY
 *      `@opaquecash/*` dependency across the sdk workspace AND the listed consumer repos
 *      (the app) to the versions being published.
 *   3. Builds the whole workspace in dependency order.
 *   4. Publishes each package in topological order (skips any version already on npm, so
 *      re-running after a failure is safe).
 *   5. Commits the version changes in the sdk repo (and each consumer repo) so the tree
 *      matches npm. Pushing is left to you.
 *
 * Usage:
 *   npm login                     # once, if not already authed
 *   node scripts/publish-starknet-cascade.mjs          # do it
 *   node scripts/publish-starknet-cascade.mjs --dry-run # print the plan, touch nothing
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SDK_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DRY_RUN = process.argv.includes("--dry-run");

// The packages this release publishes, with their target versions. New packages keep
// their 0.1.0; changed packages take the 0.3.0 Starknet-release minor.
const RELEASE = {
  "@opaquecash/deployments": "0.3.0",
  "@opaquecash/stealth-chain-starknet": "0.1.0",
  "@opaquecash/psr-chain-starknet": "0.1.0",
  "@opaquecash/opaque": "0.3.0",
  "@opaquecash/react": "0.3.0",
};

// Publish order: a package must come after everything it depends on.
const PUBLISH_ORDER = [
  "@opaquecash/deployments",
  "@opaquecash/stealth-chain-starknet",
  "@opaquecash/psr-chain-starknet",
  "@opaquecash/opaque",
  "@opaquecash/react",
];

// Consumer repos (outside the sdk workspace) whose package.json @opaquecash/* deps should
// be re-pinned to the published versions, so a fresh `npm install` resolves from npm.
const CONSUMER_REPOS = [resolve(SDK_ROOT, "..", "app")];

const log = (...a) => console.log(...a);
const step = (s) => log(`\n\x1b[1m==> ${s}\x1b[0m`);

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: "pipe", encoding: "utf8", ...opts }).trim();
}

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

/** Every package.json under sdk/packages/*. */
function workspaceManifests() {
  const dir = join(SDK_ROOT, "packages");
  return readdirSync(dir)
    .map((name) => join(dir, name, "package.json"))
    .filter(existsSync);
}

/** Set the version (if released) and re-pin any released @opaquecash/* dep. Returns true if changed. */
function rewrite(manifestPath) {
  const pkg = readJson(manifestPath);
  let changed = false;

  if (RELEASE[pkg.name] && pkg.version !== RELEASE[pkg.name]) {
    pkg.version = RELEASE[pkg.name];
    changed = true;
  }
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [dep, target] of Object.entries(RELEASE)) {
      if (deps[dep] && deps[dep] !== target) {
        deps[dep] = target;
        changed = true;
      }
    }
  }
  if (changed && !DRY_RUN) writeJson(manifestPath, pkg);
  return { changed, name: pkg.name };
}

function isPublished(name, version) {
  try {
    return sh(`npm view ${name}@${version} version 2>/dev/null`) === version;
  } catch {
    return false;
  }
}

function gitCommit(cwd, message) {
  const dirty = sh("git status --porcelain", { cwd });
  if (!dirty) return false;
  if (DRY_RUN) return true;
  sh("git add -A", { cwd });
  sh(`git commit -q -m ${JSON.stringify(message)}`, { cwd });
  return true;
}

// 1. Auth check (skipped on a dry run, which changes and publishes nothing).
if (!DRY_RUN) {
  step("Checking npm auth");
  try {
    log(`  logged in as: ${sh("npm whoami")}`);
  } catch {
    console.error("  Not logged in to npm. Run `npm login` first, then re-run this script.");
    process.exit(1);
  }
}

// 2. Rewrite versions + cross-refs across the workspace and consumers.
step(DRY_RUN ? "Plan: version + dependency rewrites" : "Rewriting versions + dependency pins");
for (const [name, version] of Object.entries(RELEASE)) log(`  ${name} -> ${version}`);
const touched = [];
for (const m of workspaceManifests()) {
  const { changed, name } = rewrite(m);
  if (changed) touched.push(name);
}
for (const repo of CONSUMER_REPOS) {
  const m = join(repo, "package.json");
  if (existsSync(m) && rewrite(m).changed) touched.push(`consumer:${repo}`);
}
log(`  updated ${touched.length} manifest(s)`);

if (DRY_RUN) {
  step("Dry run — publish order");
  for (const name of PUBLISH_ORDER) {
    log(`  ${name}@${RELEASE[name]} ${isPublished(name, RELEASE[name]) ? "(already on npm, would skip)" : "(would publish)"}`);
  }
  log("\nDry run complete. No files written, nothing published.");
  process.exit(0);
}

// 3. Build the whole workspace in dependency order.
step("Building the workspace");
sh("npm install", { cwd: SDK_ROOT, stdio: "inherit" });
sh("npm run build", { cwd: SDK_ROOT, stdio: "inherit" });

// 4. Publish in topological order (idempotent: skip versions already on npm).
step("Publishing to npm");
for (const name of PUBLISH_ORDER) {
  const version = RELEASE[name];
  if (isPublished(name, version)) {
    log(`  ${name}@${version} already on npm — skipping`);
    continue;
  }
  log(`  publishing ${name}@${version} ...`);
  sh(`npm publish --workspace ${name} --access public`, { cwd: SDK_ROOT, stdio: "inherit" });
  log(`  published ${name}@${version}`);
}

// 5. Commit the version changes so the repos match npm.
step("Committing version changes");
const msg = "Publish the Starknet SDK cascade (deployments/opaque/react 0.3.0, *-starknet 0.1.0)";
if (gitCommit(SDK_ROOT, msg)) log(`  committed in ${SDK_ROOT}`);
for (const repo of CONSUMER_REPOS) {
  if (existsSync(join(repo, ".git")) || existsSync(join(repo, "package.json"))) {
    if (gitCommit(repo, "Bump @opaquecash SDK to the Starknet release")) log(`  committed in ${repo}`);
  }
}

step("Done");
log("Published the Starknet cascade and re-pinned every consumer. Remaining:");
log("  - git push each repo you want to publish (sdk, app).");
log("  - in app/, run `npm install` to pull the published SDK, then wire the Starknet UI.");
