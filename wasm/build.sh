#!/usr/bin/env bash
# Builds site/ftw.mjs + site/ftw.wasm: FreeType 2.13.2 with HarfBuzz 8.3.0,
# configured like the FreeType that freetype-py 2.5.1 bundles, so the browser
# converter rasterizes the same bitmaps as the native one.
#
# Usage: source <emsdk>/emsdk_env.sh && wasm/build.sh [work-dir]
# (or set EMCC/EMXX, e.g. EMCC="python <emsdk>/upstream/emscripten/emcc.py")
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# Windows-native emcc.py needs native paths, not MSYS ones.
command -v cygpath >/dev/null && HERE="$(cygpath -m "$HERE")"
WORK="${1:-$HERE/build}"
OUT="$HERE/../site"
PYTHON="${PYTHON:-python}"
EMCC="${EMCC:-emcc}"
EMXX="${EMXX:-em++}"

FT=freetype-2.13.2
HB=harfbuzz-8.3.0

mkdir -p "$WORK/obj" "$WORK/cfg/freetype/config"
cd "$WORK"

fetch() {
  local url=$1 sha=$2 file
  file=$(basename "$url")
  [ -f "$file" ] || curl -fsSL -o "$file" "$url"
  echo "$sha  $file" | sha256sum -c -
  [ -d "${file%.tar.xz}" ] || "$PYTHON" -c "import tarfile,sys; tarfile.open(sys.argv[1]).extractall('.', filter='data')" "$file"
}

fetch "https://download.savannah.gnu.org/releases/freetype/$FT.tar.xz" \
  12991c4e55c506dd7f9b765933e62fd2be2e06d421505d7950a132e4f1bb484d
fetch "https://github.com/harfbuzz/harfbuzz/releases/download/8.3.0/$HB.tar.xz" \
  109501eaeb8bde3eadb25fab4164e993fbace29c3d775bcaa1c1e58e2f15f847

# FreeType's CMake build with HarfBuzz found: stock ftoption.h with USE_HARFBUZZ enabled.
sed -E 's|/\* +(#define +FT_CONFIG_OPTION_USE_HARFBUZZ) +\*/|\1|' \
  "$FT/include/freetype/config/ftoption.h" > cfg/freetype/config/ftoption.h
grep -q '^#define FT_CONFIG_OPTION_USE_HARFBUZZ' cfg/freetype/config/ftoption.h

FT_SRCS="autofit/autofit base/ftbase base/ftbbox base/ftbdf base/ftbitmap base/ftcid
  base/ftfstype base/ftgasp base/ftglyph base/ftgxval base/ftinit base/ftmm base/ftotval
  base/ftpatent base/ftpfr base/ftstroke base/ftsynth base/fttype1 base/ftwinfnt bdf/bdf
  bzip2/ftbzip2 cache/ftcache cff/cff cid/type1cid gzip/ftgzip lzw/ftlzw pcf/pcf pfr/pfr
  psaux/psaux pshinter/pshinter psnames/psnames raster/raster sdf/sdf sfnt/sfnt
  smooth/smooth svg/svg truetype/truetype type1/type1 type42/type42 winfonts/winfnt
  base/ftsystem base/ftdebug"

INCLUDES="-Icfg -I$FT/include -I$HB/src"

for src in $FT_SRCS; do
  obj="obj/ft_$(echo "$src" | tr / _).o"
  extra=""
  # Native x86-64/arm64 FreeType flattens conics with DDA (ftgrays.c BEZIER_USE_DDA,
  # keyed off __SSE2__); plain wasm32 takes the binary-split path instead, which
  # shifts a few anti-aliased pixels. SSE2 emulation selects the native path.
  [ "$src" = smooth/smooth ] && extra="-msimd128 -msse2"
  [ -f "$obj" ] || $EMCC -O2 -DNDEBUG -DFT2_BUILD_LIBRARY $extra $INCLUDES -c "$FT/src/$src.c" -o "$obj" &
done
wait

[ -f obj/harfbuzz.o ] || $EMXX -O2 -DNDEBUG -fno-rtti -fno-exceptions -fno-threadsafe-statics \
  -DHAVE_FREETYPE=1 -DHAVE_FT_GET_VAR_BLEND_COORDINATES=1 -DHAVE_FT_SET_VAR_BLEND_COORDINATES=1 \
  -DHAVE_FT_DONE_MM_VAR=1 $INCLUDES -c "$HB/src/harfbuzz.cc" -o obj/harfbuzz.o

$EMCC -O2 $INCLUDES -c "$HERE/ftw.c" -o obj/ftw.o

$EMXX -O2 obj/*.o -o "$OUT/ftw.mjs" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createFtw \
  -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS=_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAP32

ls -l "$OUT/ftw.mjs" "$OUT/ftw.wasm"
