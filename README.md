# indic-cpfont-converter

Convert TrueType fonts to `.cpfont` files for the [CrossInk-Indic](https://github.com/Somnius/CrossInk-Indic) e-reader firmware, entirely in the browser.

The output carries the OpenType shaping data that CrossInk-Indic's on-device shaper needs, so Bengali and other Indic scripts render with proper conjuncts, reph and reordered vowel signs. Fonts never leave the visitor's browser, and the site is plain static files that can be hosted anywhere, including Cloudflare Pages.

## Using it

1. Choose or drop one or more `.ttf` files. Each font gets an editable family name, and the page previews its output path.
2. Pick the script (Bengali by default; Devanagari, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam, Sinhala and Myanmar are also supported) and the point sizes (default `10,12,14,16`).
3. Click **Convert & download**. You get one zip for all the fonts:

   ```text
   .fonts/
   ├── Purno/
   │   ├── Purno_10.cpfont
   │   ├── Purno_12.cpfont
   │   ├── Purno_14.cpfont
   │   └── Purno_16.cpfont
   └── Kalpurush/
       └── ...
   ```

4. Copy the `.fonts` folder to the root of the SD card, merging it with any existing one. Then choose the font under **Settings → Reader → Font Family**.

Options:

- **Include Latin letters and punctuation** (on by default): adds Latin glyphs for mixed English text.
- **Darker anti-aliasing**: uses the same shading as the built-in reader fonts (`--darken-aa`).
- **Force FreeType auto-hinting**: ignores the font's own hinting (`--force-autohint`).

Requirements:

- **Fonts:** static TrueType (`.ttf`) only. Variable fonts and `.otf` files are rejected with a message.
- **Browser:** WebAssembly SIMD support (Chrome 91+, Firefox 89+, Safari 16.4+).
- **Download:** the first visit fetches about 15 MB of runtime from the jsDelivr CDN; browsers cache it after that.

## How it works

The converter is [CrossInk-Indic's](https://github.com/Somnius/CrossInk-Indic) own `fontconvert_sdcard.py`, running unmodified:

- [Pyodide](https://pyodide.org) runs Python and fontTools 4.62.1 in the browser, inside a Web Worker.
- FreeType 2.13.2 and HarfBuzz 8.3.0 are compiled to WebAssembly (`site/ftw.wasm`), configured like the FreeType that `freetype-py` 2.5.1 bundles. The auto-hinter uses HarfBuzz to classify glyphs that only exist through GSUB substitutions, such as conjuncts, so it has to be included.
- `site/py/freetype/` stands in for `freetype-py`. It implements only the part of `freetype-py` the converter uses, on top of the WebAssembly module.

One build detail matters for matching native output. On x86-64 and arm64, FreeType flattens curves with a DDA algorithm, but a plain wasm32 build uses binary subdivision instead, which shifts a few anti-aliased pixels. The smooth rasterizer is therefore compiled with `-msimd128 -msse2`, so it takes the same path as native builds.

**Fidelity:** output is byte-identical to the native Python converter (fontTools 4.62.1, freetype-py 2.5.1). This was checked on 56 files:

- six Bengali fonts, plus Noto Sans Devanagari and Noto Sans Tamil
- at 10, 12, 14 and 16 pt
- with default options, and again with darker anti-aliasing and forced auto-hinting
- covering both bytecode-hinted fonts and fonts FreeType auto-hints

## Deploying to Cloudflare Pages

The `site/` folder is the whole website, and it needs no build step.

**From GitHub:** in the Cloudflare dashboard, go to **Workers & Pages → Create → Pages → Connect to Git** and pick this repository, then set:

- Framework preset: **None**
- Build command: *(empty)*
- Build output directory: **`site`**

**By direct upload**, in the dashboard: **Workers & Pages → Create → Pages → Upload assets**, then upload the `site` folder.

**By direct upload, from the command line:**

```bash
npx wrangler pages deploy site --project-name indic-cpfont-converter
```

`site/_headers` sets the MIME types for the `.mjs` and `.wasm` files and caching for the WebAssembly module. Any other static host works too, as long as it serves `.wasm` as `application/wasm`.

To try it locally, serve the folder with any static server:

```bash
npx serve site
```

## Rebuilding the WebAssembly module

You only need to do this if you change `wasm/ftw.c` or the FreeType/HarfBuzz build. The prebuilt `site/ftw.mjs` and `site/ftw.wasm` are committed.

1. Install the Emscripten SDK, using the same version that was used to build the committed module:

   ```bash
   git clone https://github.com/emscripten-core/emsdk.git
   cd emsdk && ./emsdk install 5.0.3 && ./emsdk activate 5.0.3 && source ./emsdk_env.sh
   ```

2. Run the build from the repository root:

   ```bash
   wasm/build.sh
   ```

   The script:
   - downloads the FreeType and HarfBuzz release tarballs and verifies their SHA-256 checksums
   - generates `ftoption.h` the way FreeType's CMake build does when HarfBuzz is enabled
   - writes `site/ftw.mjs` and `site/ftw.wasm`

   Build files go to `wasm/build/` by default, or pass a different work directory as the first argument. On Windows, where Emscripten only ships `.bat`/`.py` entry points, point the script at the Python ones:

   ```bash
   EMCC="python <emsdk>/upstream/emscripten/emcc.py" EMXX="python <emsdk>/upstream/emscripten/em++.py" wasm/build.sh
   ```

## Verifying output against the native converter

The test runs the browser engine under Node, then rebuilds the same fonts with native Python and compares every file byte for byte.

```bash
# 1. Convert with the browser engine under Node (writes one zip per font)
npm install pyodide@314.0.7
node test/compare.mjs out bengali 10,12,14,16 "MyFont.ttf=MyFont"

# 2. Build native reference files and compare byte for byte
python -m venv venv && venv/bin/pip install fonttools==4.62.1 freetype-py==2.5.1
venv/bin/python test/compare_ref.py ref out bengali 10,12,14,16 "MyFont.ttf=MyFont"
```

On Windows the venv's Python is at `venv\Scripts\python` rather than `venv/bin/python`.

To test the Advanced options, set `CPFONT_FLAGS="--darken-aa --force-autohint"` for both commands.

## Project layout

```text
site/            the static website (deploy this folder)
  index.html, styles.css, app.mjs    page and UI
  worker.mjs, engine.mjs             Pyodide + converter, run in a Web Worker
  ftbridge.mjs, ftw.mjs, ftw.wasm    FreeType/HarfBuzz WebAssembly module and its JS bridge
  py/                                CrossInk-Indic converter (unmodified), freetype shim, batch runner
  licenses/                          third-party license texts
wasm/            build script and C wrapper for ftw.wasm
test/            Node and native comparison scripts
```

## Credits and licenses

- **Converter** (`site/py/fontconvert_sdcard.py`, `shaping_blob.py`, `cpfont_version.py`): from [CrossInk-Indic](https://github.com/Somnius/CrossInk-Indic), which is based on [CrossInk](https://github.com/uxjulia/CrossInk) and [CrossPoint Reader](https://github.com/crosspoint-reader/crosspoint-reader). MIT license; see `site/licenses/CrossInk-Indic-MIT.txt`.
- **[FreeType](https://www.freetype.org):** FreeType License; see `site/licenses/FreeType-FTL.txt`. Portions of this software are copyright © 2023 The FreeType Project (www.freetype.org). All rights reserved.
- **[HarfBuzz](https://harfbuzz.github.io):** "Old MIT" license; see `site/licenses/HarfBuzz.txt`.
- **[Pyodide](https://pyodide.org)** (MPL-2.0) and **[fontTools](https://github.com/fonttools/fonttools)** (MIT) are loaded from the jsDelivr CDN at runtime.

This is an independent community tool. It is not an official CrossInk, CrossPoint or Xteink release.
