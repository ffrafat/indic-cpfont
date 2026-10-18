"""Browser stand-in for freetype-py 2.5.1.

Implements the part of freetype-py that fontconvert_sdcard.py uses, on top of
FreeType 2.13.2 compiled to WebAssembly (ftw.wasm, exposed as `_ftw`).
Semantics follow freetype-py: errors raise FT_Exception, `glyph` and `size`
return fresh snapshots of the current slot and size metrics.
"""

from collections import namedtuple

import _ftw
from pyodide.ffi import to_js

FT_LOAD_DEFAULT = 0x0
FT_LOAD_NO_SCALE = 0x1
FT_LOAD_NO_HINTING = 0x2
FT_LOAD_RENDER = 0x4
FT_LOAD_NO_BITMAP = 0x8
FT_LOAD_FORCE_AUTOHINT = 0x20
FT_LOAD_NO_AUTOHINT = 0x8000


class FT_Exception(Exception):
    def __init__(self, errcode, message=""):
        self.errcode = errcode
        self.message = message
        super().__init__(f"FT_Error 0x{errcode:02x}" + (f": {message}" if message else ""))


def version():
    v = _ftw.version()
    return (v // 10000, v // 100 % 100, v % 100)


Vector = namedtuple("Vector", "x y")


class Bitmap:
    __slots__ = ("width", "rows", "pitch", "buffer")

    def __init__(self, width, rows, pitch, buffer):
        self.width = width
        self.rows = rows
        self.pitch = pitch
        self.buffer = buffer


class GlyphSlot:
    def __init__(self, info, buffer):
        width, rows, pitch, left, top, linear, advance_x, advance_y = info
        self.bitmap = Bitmap(width, rows, pitch, buffer)
        self.bitmap_left = left
        self.bitmap_top = top
        self.linearHoriAdvance = linear
        self.advance = Vector(advance_x, advance_y)


class SizeMetrics:
    def __init__(self, values):
        self.height, self.ascender, self.descender, self.x_ppem, self.y_ppem, self.max_advance = values


class Face:
    def __init__(self, path_or_stream, index=0):
        if isinstance(path_or_stream, (bytes, bytearray, memoryview)):
            data = bytes(path_or_stream)
        elif hasattr(path_or_stream, "read"):
            data = path_or_stream.read()
        else:
            with open(path_or_stream, "rb") as f:
                data = f.read()
        handle, error = _ftw.newFace(to_js(data), index)
        if error:
            raise FT_Exception(error)
        self._handle = handle

    def __del__(self):
        handle = getattr(self, "_handle", 0)
        if handle:
            _ftw.doneFace(handle)
            self._handle = 0

    def set_char_size(self, width=0, height=0, hres=72, vres=72):
        error = _ftw.setCharSize(self._handle, width, height, hres, vres)
        if error:
            raise FT_Exception(error)

    def get_char_index(self, charcode):
        if isinstance(charcode, str):
            charcode = ord(charcode)
        return _ftw.getCharIndex(self._handle, charcode)

    def load_glyph(self, index, flags=FT_LOAD_RENDER):
        error = _ftw.loadGlyph(self._handle, index, flags)
        if error:
            raise FT_Exception(error)

    @property
    def glyph(self):
        info = _ftw.slotInfo(self._handle).to_py()
        buffer = _ftw.slotBuffer(self._handle).to_bytes()
        return GlyphSlot(info, buffer)

    @property
    def size(self):
        return SizeMetrics(_ftw.sizeMetrics(self._handle).to_py())
