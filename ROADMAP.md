# Roadmap

## Phase 1 (done): `.cpfont` for CrossInk-Indic

A browser tool that turns `.ttf` fonts into `.cpfont` files with OpenType shaping data. Its output is byte-identical to the native converter. It serves one firmware family (CrossPoint / CrossInk / CrossInk-Indic), because `.cpfont` is that family's own format.

## Phase 2: Bangla on electronics in general

The goal is correct Bangla on any small device, not only one e-reader: conjuncts (যুক্তাক্ষর), reph, ya-phala and ra-phala, vowel signs that move before their consonant, and hasanta.

Most embedded graphics libraries draw one glyph per codepoint and do no Indic shaping. That applies to Adafruit GFX, U8g2 and TFT_eSPI, and as far as we know to LVGL as well; check LVGL's current status before starting. So the real gap is shaping. Font files alone don't close it.

### 1. A portable shaping library (highest value)

- **Extract the shaper:** take CrossInk-Indic's `lib/OtShaper` (MIT, C++) out as a standalone library with no Arduino or firmware dependencies.
- **API:** UTF-8 text plus a font's layout tables in, glyph IDs and positions out.
  - Read the tables in place from flash and keep RAM use at a few KB, as CrossInk-Indic already does on the ESP32-C3.
- **Targets:** ESP32 (C3/S3), RP2040/RP2350, STM32, nRF52.
- **Tests:** keep checking against HarfBuzz. CrossInk-Indic already has fixtures and a `compare_harfbuzz.py` to start from.
- **Packaging:** ship it as an Arduino library, an ESP-IDF component, a PlatformIO library and plain CMake.

### 2. Plug the shaper into common renderers

Each integration means calling the shaper and then drawing glyphs by glyph ID, not by codepoint.

- **LVGL:** a custom font engine that shapes before drawing, plus a glyph cache.
- **Adafruit GFX / Arduino_GFX, TFT_eSPI:** `drawBanglaString()`-style helpers.
- **U8g2:** monochrome OLEDs and LCDs (1-bit glyphs).
- **e-paper:** GxEPD2 and epdiy.

### 3. Generalize this converter: one upload, many targets

Extend this site so a single `.ttf` can produce:

- **Output formats:** LVGL font C arrays or binary fonts, Adafruit GFX headers, U8g2 fonts, and raw bitmaps with a small index.
- **Bit depth:** 1-bit (OLED, monochrome LCD), 2-bit (e-ink), and 4- or 8-bit (color TFT).
- **The same glyph-ID set and layout tables** that the shaper in item 1 needs, packaged for each target.

### 4. Smaller fonts for small flash

- **Subset by corpus:** keep only the conjuncts that actually occur in a body of real Bangla text (news, books, UI strings). A "common conjunct set" covering nearly all everyday text could be far smaller than the full font.
- **Report coverage:** show what share of a sample text a subset covers before generating it.

### 5. Shaping at build time, for fixed text

Many devices only show known strings: menus, labels, status messages. For those, shape the text when the firmware is built:

- **Output:** turn a string table into glyph sequences, plus a font cut down to just the glyphs those sequences use.
- **Runtime cost:** none, because the device only draws glyphs, so it even works on tiny MCUs with no room for a shaper.
- **Origin:** this generalizes the private-use-codepoint trick from the Calibre plugin, but with no limit on which fonts it works with.

### 6. Text handling beyond drawing

- **Normalization:** Unicode NFC for Bangla, including the nukta letters (য়, ড়, ঢ়) and khanda ta (ৎ), whose composed and decomposed forms must render the same.
- **Line breaking:** break between syllables, never inside a conjunct (UAX #14 plus syllable rules). CrossInk-Indic has Indic hyphenation tries to reuse.
- **Justification:** stretch spaces, never glyph clusters.
- **Numbers and dates:** Bangla digits (০–৯), number formatting, and the Bangla calendar (বঙ্গাব্দ) for clocks and other date displays.

### 7. Input on devices

- **Phonetic input:** a small C engine that turns Latin keystrokes into Bangla (Avro-style), for devices with a few buttons or a small keyboard.
- **On-screen keyboard:** an LVGL widget with a Bangla layout and conjunct composition.

### 8. Content preparation tools

- **Legacy-encoding converter:** Bijoy/SutonnyMJ-style ANSI to Unicode, since a lot of Bangla text and older ebooks are still in legacy encodings. It could live on this same site.
- **EPUB checker:** report fonts, encoding problems and missing glyphs before loading a book onto a device.

### 9. Quality and testing

- **Standard test page:** every consonant with every vowel sign, common conjuncts, reph plus vowel combinations, ya-phala and ra-phala, hasanta, and mixed Bangla/English.
- **Visual regression:** render that page on each target and compare it with HarfBuzz plus FreeType output.
- **Font compatibility list:** keep a public list of which fonts shape correctly (see below).

### 10. Upstream and community

- **Contribute back:** send fixes and Bangla UI translation reviews to CrossInk-Indic.
- **Native-speaker review:** get native speakers to check rendering on real hardware. CrossInk-Indic is so far tested in its simulator and QEMU.

## Notes from phase 1

- **Font quality matters as much as the engine.** SolaimanLipi's GPOS/GDEF tables contain an invalid `ClassDef` (format 0), so some marks overlap even with a correct shaper. Kalpurush, Purno, Noto Serif Bengali, Shurjo and Li Subha Letterpress converted cleanly.
- **The auto-hinter needs HarfBuzz.** Many Bangla fonts carry no TrueType hinting, so FreeType auto-hints them. Without HarfBuzz, the auto-hinter can't classify conjunct glyphs that are only reachable through GSUB, and they come out hinted differently.
- **Rasterizers differ by platform.** FreeType flattens curves with DDA on x86-64 and arm64 but with binary splits on other targets. For identical output across devices, pin that choice; this project uses `-msse2` for WebAssembly.
- **Pin versions to compare outputs.** Exact matches need the same fontTools and FreeType versions on both sides.
