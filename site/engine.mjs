// Loads Pyodide + fontTools + ftw.wasm and runs the converter.
// Used by worker.mjs in the browser and by test/compare.mjs in Node.

import { createBridge } from "./ftbridge.mjs";

export const PYODIDE_VERSION = "314.0.7";
export const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

const PY_FILES = [
  "fontconvert_sdcard.py",
  "shaping_blob.py",
  "cpfont_version.py",
  "runner.py",
  "freetype/__init__.py",
];
const PY_ROOT = "/opt/cpfont";

// loadPyodide: Pyodide's loader; readAsset(path) -> Uint8Array; createFtw: ftw.mjs factory.
export async function createEngine({ loadPyodide, pyodideOptions = {}, readAsset, createFtw, onLog = () => {} }) {
  onLog("Loading Python runtime…");
  const pyodide = await loadPyodide(pyodideOptions);
  pyodide.setStdout({ batched: onLog });
  pyodide.setStderr({ batched: onLog });

  onLog("Loading fontTools…");
  await pyodide.loadPackage("fonttools", { messageCallback: () => {} });

  onLog("Loading FreeType (WebAssembly)…");
  const ftw = createBridge(await createFtw());
  pyodide.registerJsModule("_ftw", ftw);

  pyodide.FS.mkdirTree(`${PY_ROOT}/freetype`);
  pyodide.FS.mkdirTree("/work/in");
  for (const file of PY_FILES) {
    pyodide.FS.writeFile(`${PY_ROOT}/${file}`, await readAsset(`py/${file}`));
  }
  pyodide.runPython(`import sys; sys.path.insert(0, ${JSON.stringify(PY_ROOT)})`);
  const runner = pyodide.pyimport("runner");
  const freetypeVersion = pyodide.runPython("import freetype; '.'.join(map(str, freetype.version()))");
  const fonttoolsVersion = pyodide.runPython("import fontTools; fontTools.version");
  onLog(`Ready: FreeType ${freetypeVersion}, fontTools ${fonttoolsVersion}`);

  return {
    freetypeVersion,
    fonttoolsVersion,
    scripts: runner.scripts().toJs(),

    // fonts: [{ fileName, bytes: Uint8Array, family }]
    // options: { script, sizes, includeLatin, darkenAa, forceAutohint }
    convert(fonts, options) {
      const jobs = fonts.map((font, i) => {
        const path = `/work/in/${i}.ttf`;
        pyodide.FS.writeFile(path, font.bytes);
        return { path, fileName: font.fileName, family: font.family || "" };
      });
      try {
        const result = runner.convert_batch(JSON.stringify(jobs), JSON.stringify(options));
        const [namesJson, zip] = result.toJs();
        result.destroy();
        return { files: JSON.parse(namesJson), zip };
      } finally {
        for (const job of jobs) pyodide.FS.unlink(job.path);
      }
    },
  };
}
