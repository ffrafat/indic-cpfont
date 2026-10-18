import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs";

import { createEngine, PYODIDE_CDN } from "./engine.mjs";
import createFtw from "./ftw.mjs";

let enginePromise;

function getEngine() {
  enginePromise ??= createEngine({
    loadPyodide,
    pyodideOptions: { indexURL: PYODIDE_CDN },
    readAsset: async (asset) => {
      const response = await fetch(new URL(asset, import.meta.url));
      if (!response.ok) throw new Error(`Could not load ${asset} (${response.status})`);
      return new Uint8Array(await response.arrayBuffer());
    },
    createFtw,
    onLog: (line) => postMessage({ type: "log", line }),
  }).catch((error) => {
    enginePromise = undefined;  // let the next attempt retry, e.g. after a network blip
    throw error;
  });
  return enginePromise;
}

// Python tracebacks end with the useful line; keep the whole thing for the log.
function describe(error) {
  const text = String(error?.message ?? error).trim();
  const last = text.split("\n").filter(Boolean).at(-1) ?? text;
  return { message: last.replace(/^[\w.]+(Error|Exception): /, ""), detail: text };
}

self.onmessage = async ({ data }) => {
  try {
    const engine = await getEngine();
    if (data.type === "warmup") {
      postMessage({ type: "ready", freetype: engine.freetypeVersion, fonttools: engine.fonttoolsVersion });
    } else if (data.type === "convert") {
      const { files, zip } = engine.convert(data.fonts, data.options);
      postMessage({ type: "done", files, zip }, [zip.buffer]);
    }
  } catch (error) {
    postMessage({ type: "error", ...describe(error) });
  }
};
