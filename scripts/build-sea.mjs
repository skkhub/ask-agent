import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(root, "dist");
const bundlePath = resolve(distDir, "bundle.cjs");
const blobPath = resolve(root, "sea-prep.blob");
const seaConfigPath = resolve(root, "sea-config.json");
const isWin = process.platform === "win32";
const outputName = isWin ? "ask.exe" : "ask";
const outputPath = resolve(distDir, outputName);
const nodeBinary = process.execPath;

function nodeSupportsBuildSea() {
  const r = spawnSync(nodeBinary, ["--build-sea"], { encoding: "utf8" });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return !text.includes("bad option") && !text.includes("not allowed");
}

function detectSeaFuse(binary) {
  const out = execFileSync("strings", [binary], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const match = out.match(/NODE_SEA_FUSE_[0-9a-f]+/);
  if (!match) {
    throw new Error("在 Node 二进制中找不到 NODE_SEA_FUSE sentinel，无法注入 SEA blob");
  }
  return match[0];
}

await import("./build-bundle.mjs");

await mkdir(distDir, { recursive: true });

if (nodeSupportsBuildSea()) {
  console.log("Using node --build-sea…");
  const seaConfig = {
    main: bundlePath,
    output: outputPath,
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    useSnapshot: false,
  };
  await writeFile(seaConfigPath, `${JSON.stringify(seaConfig, null, 2)}\n`);
  execFileSync(nodeBinary, ["--build-sea", seaConfigPath], { stdio: "inherit" });
  await rm(seaConfigPath, { force: true });
} else {
  const seaConfig = {
    main: bundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    useSnapshot: false,
  };
  await writeFile(seaConfigPath, `${JSON.stringify(seaConfig, null, 2)}\n`);

  console.log("Generating SEA blob…");
  execFileSync(nodeBinary, ["--experimental-sea-config", seaConfigPath], {
    stdio: "inherit",
  });

  await copyFile(nodeBinary, outputPath);

  const fuse = detectSeaFuse(nodeBinary);
  console.log(`Injecting blob with postject (fuse: ${fuse})…`);
  const postjectBin = resolve(
    root,
    "node_modules",
    "postject",
    "dist",
    "cli.js",
  );
  if (!existsSync(postjectBin)) {
    throw new Error("postject not found — run npm install first");
  }

  const postjectArgs = [
    postjectBin,
    outputPath,
    "NODE_SEA_BLOB",
    blobPath,
    "--sentinel-fuse",
    fuse,
  ];
  if (process.platform === "darwin") {
    postjectArgs.push("--macho-segment-name", "NODE_SEA");
  }
  execFileSync(nodeBinary, postjectArgs, { stdio: "inherit" });

  if (process.platform === "darwin") {
    console.log("Re-signing macOS binary…");
    execFileSync("codesign", ["--sign", "-", outputPath], { stdio: "inherit" });
  }

  await rm(blobPath, { force: true });
  await rm(seaConfigPath, { force: true });
}

console.log(`\nDone → ${outputPath}`);
console.log(`Size: ${(await readFile(outputPath)).length.toLocaleString()} bytes`);
