"""Builds native reference .cpfont files and compares them with the browser
engine's zips byte for byte.

Run with a Python that has fonttools and freetype-py at the versions the site
uses (fontTools 4.62.1, freetype-py 2.5.1):
  python test/compare_ref.py <ref-dir> <wasm-zip-dir> <script> <sizes> <font.ttf=Family>...
CPFONT_FLAGS (e.g. "--darken-aa --force-autohint") is passed to the converter.
"""

import os
import shutil
import subprocess
import sys
import tempfile
import zipfile

SITE_PY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site", "py")
# The site's freetype/ shim sits beside these; the reference must use real freetype-py.
CONVERTER_FILES = ("fontconvert_sdcard.py", "shaping_blob.py", "cpfont_version.py")


def main():
    ref_dir, wasm_dir, script, sizes, *specs = sys.argv[1:]
    intervals = f"latin-ext,punctuation,{script}"
    converter_dir = tempfile.mkdtemp()
    for name in CONVERTER_FILES:
        shutil.copy(os.path.join(SITE_PY, name), converter_dir)
    converter = os.path.join(converter_dir, "fontconvert_sdcard.py")
    total = identical = 0
    for spec in specs:
        font_path, family = spec.rsplit("=", 1)
        out = os.path.join(ref_dir, family)
        run = subprocess.run([sys.executable, converter, "--intervals", intervals, "--sizes", sizes,
                              "--style", "regular", "--name", family, "--output-dir", out + os.sep, font_path,
                              *os.environ.get("CPFONT_FLAGS", "").split()],
                             capture_output=True, text=True)
        if run.returncode:
            sys.exit(f"native converter failed for {font_path}:\n{run.stderr[-3000:]}")
        with zipfile.ZipFile(os.path.join(wasm_dir, f"{family}.zip")) as zf:
            wasm_files = {name: zf.read(name) for name in zf.namelist()}
        for size in sizes.split(","):
            name = f"{family}/{family}_{size}.cpfont"
            with open(os.path.join(ref_dir, name), "rb") as f:
                ref = f.read()
            got = wasm_files.get(name)
            total += 1
            if got == ref:
                identical += 1
                status = "identical"
            elif got is None:
                status = "MISSING from wasm zip"
            else:
                first = next((i for i, (a, b) in enumerate(zip(ref, got)) if a != b), min(len(ref), len(got)))
                status = f"DIFFERS at byte {first} (native {len(ref)} B, wasm {len(got)} B)"
            print(f"{name:55s} {len(ref):8d} B  {status}")
    print(f"\n{identical}/{total} files identical")
    sys.exit(0 if identical == total else 1)


if __name__ == "__main__":
    main()
