import { access, chmod, mkdir, readdir, rename, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { askHome } from "./config.ts";
import { msg } from "./i18n.ts";
import * as ui from "./ui.ts";

export const DEFAULT_REPO = "skkhub/ask-agent";

export interface PlatformInfo {
  platform: string;
  artifact: string;
}

export interface SetupOpts {
  yes?: boolean;
  version?: string;
  currentVersion: string;
  confirm: (prompt: string) => Promise<boolean>;
}

function fail(message: string): never {
  ui.error(ui.c.red(message));
  process.exit(1);
}

function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, "");
}

export function detectPlatform(): PlatformInfo {
  const os = process.platform;
  let arch = process.arch;
  if (arch === "x64") arch = "x64";
  else if (arch === "arm64") arch = "arm64";
  else fail(msg().setupUnsupportedArch(arch));

  if (os === "darwin" && arch === "arm64") {
    return { platform: "darwin-arm64", artifact: "ask-macos-arm64" };
  }
  if (os === "darwin" && arch === "x64") {
    fail(msg().setupUnsupportedPlatform("darwin-x64 (Intel Mac)"));
  }
  if (os === "linux" && arch === "x64") {
    return { platform: "linux-x64", artifact: "ask-linux-x64" };
  }
  if (os === "linux" && arch === "arm64") {
    fail(msg().setupUnsupportedPlatform("linux-arm64"));
  }
  if (os === "win32" && arch === "x64") {
    return { platform: "windows-x64", artifact: "ask-windows-x64.exe" };
  }
  fail(msg().setupUnsupportedPlatform(`${os} (${arch})`));
}

export function askBinPath(): string {
  const name = process.platform === "win32" ? "ask.exe" : "ask";
  return resolve(askHome(), "bin", name);
}

export function askBinDir(): string {
  return resolve(askHome(), "bin");
}

async function fetchLatestVersion(repo: string): Promise<string> {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "ask-cli" },
  });
  if (!res.ok) {
    throw new Error(msg().updateFailed(`GitHub API ${res.status}`));
  }
  const data = (await res.json()) as { tag_name?: string };
  if (!data.tag_name) {
    throw new Error(msg().updateFailed("missing tag_name"));
  }
  return normalizeVersion(data.tag_name);
}

async function downloadRelease(
  repo: string,
  version: string,
  dest: string,
): Promise<void> {
  const { artifact } = detectPlatform();
  const url = `https://github.com/${repo}/releases/download/v${version}/${artifact}`;
  const res = await fetch(url, { headers: { "User-Agent": "ask-cli" } });
  if (!res.ok) {
    throw new Error(msg().updateFailed(`download HTTP ${res.status}`));
  }
  if (!res.body) {
    throw new Error(msg().updateFailed("empty response body"));
  }

  await mkdir(dirname(dest), { recursive: true });
  const tmp = `${dest}.new`;
  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(tmp));
  if (process.platform !== "win32") {
    await chmod(tmp, 0o755);
  }
  await rename(tmp, dest);
}

export async function cmdUpdate(opts: SetupOpts): Promise<void> {
  const repo = DEFAULT_REPO;
  const { artifact, platform } = detectPlatform();
  ui.traceLine(ui.c.dim(msg().updateChecking(repo, platform, artifact)));

  let targetVersion: string;
  if (opts.version) {
    targetVersion = normalizeVersion(opts.version);
  } else {
    try {
      targetVersion = await fetchLatestVersion(repo);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  }

  const current = normalizeVersion(opts.currentVersion);
  if (current !== "dev" && current === targetVersion) {
    ui.traceLine(msg().updateAlreadyLatest(targetVersion));
    return;
  }

  const binPath = askBinPath();
  ui.traceLine(ui.c.dim(msg().updateDownloading(artifact, targetVersion)));

  try {
    await downloadRelease(repo, targetVersion, binPath);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  const from = current === "dev" ? "dev" : current;
  process.stderr.write(`${msg().updateSuccess(from, targetVersion)}\n`);
  process.stderr.write(`${msg().updatePathHint(binPath)}\n`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function removeTreeExcept(
  dir: string,
  skipPaths: Set<string>,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(join(dir, entry.name));
    if (skipPaths.has(full)) continue;
    if (entry.isDirectory()) {
      await rm(full, { recursive: true, force: true });
    } else {
      await rm(full, { force: true });
    }
  }
}

export async function cmdUninstall(opts: SetupOpts): Promise<void> {
  const home = askHome();
  if (!(await pathExists(home))) {
    ui.traceLine(msg().uninstallNotFound);
    return;
  }

  if (!opts.yes) {
    const ok = await opts.confirm(msg().uninstallConfirm(home));
    if (!ok) {
      ui.traceLine(msg().uninstallCancelled);
      return;
    }
  }

  const binPath = askBinPath();
  const runningFromBin =
    process.platform === "win32"
      ? resolve(process.execPath).toLowerCase() === binPath.toLowerCase()
      : resolve(process.execPath) === binPath;

  if (process.platform === "win32" && runningFromBin) {
    try {
      await removeTreeExcept(home, new Set([binPath]));
      await rm(binPath, { force: true });
      ui.traceLine(msg().uninstallSuccess);
    } catch {
      ui.traceLine(msg().uninstallPartialWindows(home));
    }
    return;
  }

  try {
    await rm(home, { recursive: true, force: true });
    ui.traceLine(msg().uninstallSuccess);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    fail(msg().updateFailed(detail));
  }
}
