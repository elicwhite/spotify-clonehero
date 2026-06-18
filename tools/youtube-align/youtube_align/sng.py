"""SNG container reader.

The .sng format is an uncompressed container with XOR-masked file data, used by
Clone Hero / YARG. This reader is the inverse of the repo's writer at
`spotify-clonehero-next/lib/chart-export/sng.ts`. Format reference:
https://github.com/mdsitton/SngFileFormat

Layout (all integers little-endian):

    Header
        6  bytes  identifier "SNGPKG"
        4  bytes  version (uint32)
        16 bytes  xorMask
    Metadata section
        8  bytes  metadataPayloadSize (uint64)
        8  bytes  metadataCount (uint64)
        repeated: int32 keyLen, key, int32 valLen, val
    FileIndex section
        8  bytes  fileIndexPayloadSize (uint64)
        8  bytes  fileCount (uint64)
        repeated: uint8 nameLen, name, uint64 contentsLen, uint64 contentsIndex
    FileData section
        8  bytes  totalFileDataSize (uint64)
        masked file bytes at the absolute `contentsIndex` offsets

Masking is symmetric (XOR), and the per-byte counter resets to 0 for each file:

    xorKey = xorMask[i % 16] ^ (i & 0xFF)
    out[i] = data[i] ^ xorKey
"""

from __future__ import annotations

import struct
from dataclasses import dataclass


@dataclass
class SngFile:
    name: str
    contents_len: int
    contents_index: int


@dataclass
class Sng:
    version: int
    metadata: dict[str, str]
    files: list[SngFile]
    _raw: bytes
    _xor_mask: bytes

    def read(self, name: str) -> bytes:
        """Return the unmasked bytes of a contained file by name."""
        for f in self.files:
            if f.name == name:
                return _unmask(
                    self._raw[f.contents_index : f.contents_index + f.contents_len],
                    self._xor_mask,
                )
        raise KeyError(name)


def _unmask(data: bytes, xor_mask: bytes) -> bytes:
    out = bytearray(len(data))
    for i in range(len(data)):
        out[i] = data[i] ^ (xor_mask[i % 16] ^ (i & 0xFF))
    return bytes(out)


def parse_sng(raw: bytes) -> Sng:
    if raw[:6] != b"SNGPKG":
        raise ValueError("not an SNG file (bad identifier)")
    off = 6
    (version,) = struct.unpack_from("<I", raw, off)
    off += 4
    xor_mask = raw[off : off + 16]
    off += 16

    # Metadata section
    (meta_payload,) = struct.unpack_from("<Q", raw, off)
    off += 8
    meta_end = off + meta_payload
    (meta_count,) = struct.unpack_from("<Q", raw, off)
    off += 8
    metadata: dict[str, str] = {}
    for _ in range(meta_count):
        (klen,) = struct.unpack_from("<i", raw, off)
        off += 4
        key = raw[off : off + klen].decode("utf-8")
        off += klen
        (vlen,) = struct.unpack_from("<i", raw, off)
        off += 4
        val = raw[off : off + vlen].decode("utf-8")
        off += vlen
        metadata[key] = val
    off = meta_end

    # FileIndex section
    (index_payload,) = struct.unpack_from("<Q", raw, off)
    off += 8
    index_end = off + index_payload
    (file_count,) = struct.unpack_from("<Q", raw, off)
    off += 8
    files: list[SngFile] = []
    for _ in range(file_count):
        nlen = raw[off]
        off += 1
        name = raw[off : off + nlen].decode("utf-8")
        off += nlen
        (clen,) = struct.unpack_from("<Q", raw, off)
        off += 8
        (cidx,) = struct.unpack_from("<Q", raw, off)
        off += 8
        files.append(SngFile(name=name, contents_len=clen, contents_index=cidx))
    off = index_end

    return Sng(
        version=version,
        metadata=metadata,
        files=files,
        _raw=raw,
        _xor_mask=xor_mask,
    )


def build_sng(metadata: dict[str, str], files: dict[str, bytes], xor_mask: bytes | None = None) -> bytes:
    """Build an SNG container. Used only by tests to exercise the reader."""
    if xor_mask is None:
        xor_mask = bytes(range(16))
    assert len(xor_mask) == 16

    meta_entries = [(k, v) for k, v in metadata.items() if k and v]
    meta_payload = 8
    for k, v in meta_entries:
        meta_payload += 4 + len(k.encode()) + 4 + len(v.encode())

    index_payload = 8
    for name in files:
        index_payload += 1 + len(name.encode()) + 8 + 8

    header_size = 26
    meta_section = 8 + meta_payload
    index_section = 8 + index_payload
    file_data_start = header_size + meta_section + index_section + 8

    out = bytearray()
    out += b"SNGPKG"
    out += struct.pack("<I", 1)
    out += xor_mask

    out += struct.pack("<Q", meta_payload)
    out += struct.pack("<Q", len(meta_entries))
    for k, v in meta_entries:
        kb, vb = k.encode(), v.encode()
        out += struct.pack("<i", len(kb)) + kb
        out += struct.pack("<i", len(vb)) + vb

    out += struct.pack("<Q", index_payload)
    out += struct.pack("<Q", len(files))
    cursor = file_data_start
    for name, data in files.items():
        nb = name.encode()
        out += struct.pack("<B", len(nb)) + nb
        out += struct.pack("<Q", len(data))
        out += struct.pack("<Q", cursor)
        cursor += len(data)

    total = sum(len(d) for d in files.values())
    out += struct.pack("<Q", total)
    for data in files.values():
        out += _unmask(data, xor_mask)  # unmask is symmetric == mask

    return bytes(out)
