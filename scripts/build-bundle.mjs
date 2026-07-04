import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { readFileSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const outFile = resolve(root, "dist/bundle.cjs");

await mkdir(dirname(outFile), { recursive: true });

await esbuild.build({
  entryPoints: [resolve(root, "src/cli.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: outFile,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  logLevel: "info",
});

console.log(`Bundled → ${outFile}`);
