"""Runs the unmodified fontconvert_sdcard.py for each uploaded font and zips
the results as .fonts/<Family>/<Family>_<size>.cpfont."""

import io
import json
import os
import re
import shutil
import sys
import zipfile

import fontconvert_sdcard
import shaping_blob

OUT_ROOT = "/work/out"
STYLE_SUFFIX = re.compile(r"[-_ ](regular|bold|italic|bolditalic|bold italic)$", re.IGNORECASE)


def scripts():
    return list(shaping_blob.SCRIPTS)


def derive_family_name(file_name):
    return STYLE_SUFFIX.sub("", os.path.splitext(os.path.basename(file_name))[0])


def sanitize_family_name(name):
    name = re.sub(r"[^A-Za-z0-9 _-]+", "", name).strip()
    return name or "Font"


def parse_sizes(raw):
    sizes = [int(part) for part in str(raw).replace(" ", "").split(",") if part]
    if not sizes:
        raise ValueError("Enter at least one point size.")
    for size in sizes:
        if not 6 <= size <= 72:
            raise ValueError(f"Size {size} is out of range (6-72).")
    return sizes


def check_font(path, file_name, script):
    """Fail before any work starts, naming the file, instead of mid-batch with a FreeType code."""
    from fontTools.ttLib import TTFont

    try:
        font = TTFont(path, fontNumber=0, lazy=True)
        tables = set(font.keys())
        cmap = font.getBestCmap() or {}
    except Exception as error:  # any parse failure of an uploaded file means it's unusable
        raise ValueError(f"{file_name} isn't a valid font file ({error}).") from None
    if "fvar" in tables:
        raise ValueError(f"{file_name} is a variable font; export a static instance (e.g. Regular) first.")
    if "glyf" not in tables:
        raise ValueError(f"{file_name} has no TrueType outlines (glyf table); use a static .ttf.")
    probe = shaping_blob.SCRIPTS[script].probe
    if probe not in cmap:
        print(f"Warning: {file_name} has no {script} letters (U+{probe:04X}); it will convert without them.",
              file=sys.stderr)


def convert_batch(jobs_json, options_json):
    jobs = json.loads(jobs_json)
    options = json.loads(options_json)

    script = options["script"]
    if script not in shaping_blob.SCRIPTS:
        raise ValueError(f"Unknown script: {script}")
    sizes = parse_sizes(options["sizes"])
    intervals = ",".join((["latin-ext", "punctuation"] if options.get("includeLatin", True) else []) + [script])

    families = [sanitize_family_name(job.get("family") or derive_family_name(job["fileName"])) for job in jobs]
    duplicates = sorted({f for f in families if families.count(f) > 1})
    if duplicates:
        raise ValueError(f"Two fonts would share the family name {', '.join(duplicates)}; rename one.")

    for job in jobs:
        check_font(job["path"], job["fileName"], script)

    shutil.rmtree(OUT_ROOT, ignore_errors=True)
    for job, family in zip(jobs, families):
        argv = ["fontconvert_sdcard.py",
                "--intervals", intervals,
                "--sizes", ",".join(map(str, sizes)),
                "--style", "regular",
                "--name", family,
                "--output-dir", f"{OUT_ROOT}/.fonts/{family}/",
                job["path"]]
        if options.get("darkenAa"):
            argv.append("--darken-aa")
        if options.get("forceAutohint"):
            argv.append("--force-autohint")

        print(f"=== {family} ({os.path.basename(job['fileName'])}) ===", file=sys.stderr)
        sys.argv = argv
        try:
            fontconvert_sdcard.main()
        except SystemExit as exit_:
            if exit_.code not in (0, None):
                raise RuntimeError(f"Converter failed for {job['fileName']} (exit {exit_.code}); see log.")

    names = []
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for dirpath, _, filenames in sorted(os.walk(OUT_ROOT)):
            for filename in sorted(filenames):
                full = os.path.join(dirpath, filename)
                arcname = os.path.relpath(full, OUT_ROOT).replace(os.sep, "/")
                zf.write(full, arcname=arcname)
                names.append(arcname)
    if not any(name.endswith(".cpfont") for name in names):
        raise RuntimeError("No .cpfont files were produced; see log.")
    return json.dumps(names), buffer.getvalue()
