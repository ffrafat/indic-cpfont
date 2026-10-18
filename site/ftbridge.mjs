// Thin JS layer over ftw.wasm, exposed to Python as the `_ftw` module.
// HEAP views are re-read on every call because memory growth replaces them.

export function createBridge(M) {
  const initError = M._ftw_init();
  if (initError) throw new Error(`FT_Init_FreeType failed: ${initError}`);

  const scratch = M._malloc(64);
  const ints = (count) => Array.from(M.HEAP32.subarray(scratch >> 2, (scratch >> 2) + count));

  return {
    version: () => M._ftw_version(),

    // Returns [handle, error]; FreeType owns the copied bytes until doneFace.
    newFace(bytes, index) {
      const ptr = M._malloc(bytes.length);
      M.HEAPU8.set(bytes, ptr);
      const handle = M._ftw_new_face(ptr, bytes.length, index, scratch);
      return [handle, M.HEAP32[scratch >> 2]];
    },

    doneFace: (handle) => M._ftw_done_face(handle),
    setCharSize: (handle, width, height, hres, vres) => M._ftw_set_char_size(handle, width, height, hres, vres),
    getCharIndex: (handle, codePoint) => M._ftw_get_char_index(handle, codePoint) >>> 0,
    loadGlyph: (handle, glyphIndex, flags) => M._ftw_load_glyph(handle, glyphIndex, flags),

    // [width, rows, pitch, bitmap_left, bitmap_top, linearHoriAdvance, advance.x, advance.y]
    slotInfo(handle) {
      M._ftw_slot_info(handle, scratch);
      const [width, rows, pitch, , left, top, linear, advanceX, advanceY] = ints(9);
      return [width, rows, pitch, left, top, linear, advanceX, advanceY];
    },

    slotBuffer(handle) {
      M._ftw_slot_info(handle, scratch);
      const [, rows, pitch, buffer] = ints(4);
      return M.HEAPU8.slice(buffer, buffer + rows * Math.abs(pitch));
    },

    // [height, ascender, descender, x_ppem, y_ppem, max_advance]
    sizeMetrics(handle) {
      M._ftw_size_metrics(handle, scratch);
      return ints(6);
    },
  };
}
