// Minimal FreeType API for the browser build of the .cpfont converter.
// Covers exactly what fontconvert_sdcard.py uses through freetype-py.

#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_LCD_FILTER_H

#include <emscripten/emscripten.h>
#include <stdint.h>
#include <stdlib.h>

typedef struct {
  FT_Face face;
  unsigned char *data;  // FT_New_Memory_Face needs the bytes alive until FT_Done_Face
} FtwFace;

static FT_Library library;

EMSCRIPTEN_KEEPALIVE int ftw_init(void) {
  int error = FT_Init_FreeType(&library);
  if (error) return error;
  // freetype-py does this on import; it only affects LCD render modes.
  FT_Library_SetLcdFilter(library, FT_LCD_FILTER_DEFAULT);
  return 0;
}

EMSCRIPTEN_KEEPALIVE FtwFace *ftw_new_face(unsigned char *data, int length, int index, int *error_out) {
  FtwFace *handle = calloc(1, sizeof(FtwFace));
  handle->data = data;
  *error_out = FT_New_Memory_Face(library, data, length, index, &handle->face);
  if (*error_out) {
    free(data);
    free(handle);
    return NULL;
  }
  return handle;
}

EMSCRIPTEN_KEEPALIVE void ftw_done_face(FtwFace *handle) {
  FT_Done_Face(handle->face);
  free(handle->data);
  free(handle);
}

EMSCRIPTEN_KEEPALIVE int ftw_set_char_size(FtwFace *handle, int width, int height, int hres, int vres) {
  return FT_Set_Char_Size(handle->face, width, height, hres, vres);
}

EMSCRIPTEN_KEEPALIVE unsigned ftw_get_char_index(FtwFace *handle, unsigned code_point) {
  return FT_Get_Char_Index(handle->face, code_point);
}

EMSCRIPTEN_KEEPALIVE int ftw_load_glyph(FtwFace *handle, unsigned glyph_index, int flags) {
  return FT_Load_Glyph(handle->face, glyph_index, flags);
}

// out: width, rows, pitch, buffer, bitmap_left, bitmap_top, linearHoriAdvance, advance.x, advance.y
EMSCRIPTEN_KEEPALIVE void ftw_slot_info(FtwFace *handle, int *out) {
  FT_GlyphSlot slot = handle->face->glyph;
  out[0] = (int)slot->bitmap.width;
  out[1] = (int)slot->bitmap.rows;
  out[2] = slot->bitmap.pitch;
  out[3] = (int)(uintptr_t)slot->bitmap.buffer;
  out[4] = slot->bitmap_left;
  out[5] = slot->bitmap_top;
  out[6] = (int)slot->linearHoriAdvance;
  out[7] = (int)slot->advance.x;
  out[8] = (int)slot->advance.y;
}

// out: height, ascender, descender, x_ppem, y_ppem, max_advance
EMSCRIPTEN_KEEPALIVE void ftw_size_metrics(FtwFace *handle, int *out) {
  FT_Size_Metrics *metrics = &handle->face->size->metrics;
  out[0] = (int)metrics->height;
  out[1] = (int)metrics->ascender;
  out[2] = (int)metrics->descender;
  out[3] = metrics->x_ppem;
  out[4] = metrics->y_ppem;
  out[5] = (int)metrics->max_advance;
}

EMSCRIPTEN_KEEPALIVE int ftw_version(void) {
  FT_Int major, minor, patch;
  FT_Library_Version(library, &major, &minor, &patch);
  return major * 10000 + minor * 100 + patch;
}
