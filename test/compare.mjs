// Converts fonts with the browser engine under Node and writes one zip per font.
// Usage: node test/compare.mjs <out-dir> <script> <sizes> <font.ttf=Family>...
// Set PYODIDE_MODULE to pyodide.mjs if the `pyodide` package is not resolvable,
// and CPFONT_FLAGS="--darken-aa --force-autohint" to test those options.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createEngine } from "../site/engine.mjs";
import createFtw from "../site/ftw.mjs";

const [outDir, script, sizes, ...specs] = process.argv.slice(2);
const flags = (process.env.CPFONT_FLAGS ?? "").split(/\s+/).filter(Boolean);
const { loadPyodide } = await import(process.env.PYODIDE_MODULE ? pathToFileURL(process.env.PYODIDE_MODULE).href : "pyodide");
const site = new URL("../site/", import.meta.url);

const engine = await createEngine({
  loadPyodide,
  readAsset: async (asset) => new Uint8Array(await readFile(new URL(asset, site))),
  createFtw,
  onLog: (line) => process.env.VERBOSE && console.error(line),
});
console.log(`engine: FreeType ${engine.freetypeVersion}, fontTools ${engine.fonttoolsVersion}`);

await mkdir(outDir, { recursive: true });
for (const spec of specs) {
  const split = spec.lastIndexOf("=");
  const [fontPath, family] = [spec.slice(0, split), spec.slice(split + 1)];
  const started = performance.now();
  const { files, zip } = engine.convert(
    [{ fileName: path.basename(fontPath), bytes: new Uint8Array(await readFile(fontPath)), family }],
    { script, sizes, includeLatin: true, darkenAa: flags.includes("--darken-aa"), forceAutohint: flags.includes("--force-autohint") },
  );
  await writeFile(path.join(outDir, `${family}.zip`), zip);
  console.log(`${family}: ${files.length} files in ${((performance.now() - started) / 1000).toFixed(1)}s`);
}
