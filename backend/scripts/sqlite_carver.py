"""
Proper SQLite b-tree reader used to recover rows from free pages.

ChromaDB stores embedding metadata in the `embedding_metadata` table:

    CREATE TABLE embedding_metadata (
        id            INTEGER PRIMARY KEY,
        key           TEXT,
        string_value  TEXT,
        int_value     INTEGER,
        float_value   REAL,
        bool_value    BOOLEAN
    )

When a collection is deleted the rows leave the b-tree but their bytes stay
in the file's free pages. This module walks every page (including freelist
pages), decodes the table-leaf cells, and hands back the raw records.
"""

import struct
import sys


def read_varint(buf: bytes, offset: int):
    """Decode a SQLite varint. Returns (value, new_offset)."""
    result = 0
    for i in range(9):
        byte = buf[offset + i]
        if i == 8:
            result = (result << 8) | byte
            return result, offset + 9
        result = (result << 7) | (byte & 0x7F)
        if not (byte & 0x80):
            return result, offset + i + 1
    return result, offset + 9


def serial_size(serial_type: int) -> int:
    if serial_type == 0:
        return 0
    if serial_type in (1, 2, 3, 4, 5, 6):
        return serial_type
    if serial_type in (7, 8, 9):
        return 8
    if serial_type in (10, 11):
        return 0
    if serial_type >= 12:
        return (serial_type - 12) // 2
    return 0


def decode_value(buf: bytes, offset: int, serial_type: int):
    size = serial_size(serial_type)
    raw = buf[offset:offset + size]
    if serial_type == 0:
        return None
    if serial_type == 1:
        return struct.unpack(">b", raw)[0]
    if serial_type == 2:
        return struct.unpack(">h", raw)[0]
    if serial_type == 3:
        return int.from_bytes(raw, "big", signed=True)
    if serial_type == 4:
        return int.from_bytes(raw, "big", signed=True)
    if serial_type == 5:
        return int.from_bytes(raw, "big", signed=True)
    if serial_type == 6:
        return int.from_bytes(raw, "big", signed=True)
    if serial_type == 7:
        return struct.unpack(">d", raw)[0]
    if serial_type == 8:
        return 0
    if serial_type == 9:
        return 1
    if serial_type >= 12 and serial_type % 2 == 0:
        return raw
    if serial_type >= 13 and serial_type % 2 == 1:
        return raw.decode("utf-8", errors="replace")
    return None


def parse_record(payload: bytes):
    """Decode a SQLite record into a list of Python values."""
    header_size, offset = read_varint(payload, 0)
    serials = []
    while offset < header_size:
        serial, offset = read_varint(payload, offset)
        serials.append(serial)

    values = []
    data_offset = header_size
    for serial in serials:
        value = decode_value(payload, data_offset, serial)
        data_offset += serial_size(serial)
        values.append(value)
    return values


def read_overflow(buf: bytes, payload_size: int, local: bytes, page_size: int, pages: dict) -> bytes:
    """Follow the overflow chain to reassemble a full payload."""
    usable = page_size - 8
    max_local = usable - 35
    min_local = ((usable - 12) * 32 // 255) - 23

    if payload_size <= max_local:
        return local

    if local:
        local_size = min_local + (payload_size - min_local) % (usable - 4)
        if local_size > max_local:
            local_size = min_local
    else:
        local_size = 0

    out = bytearray(local[:local_size])
    next_page = struct.unpack(">I", local[local_size:local_size + 4])[0] if local_size + 4 <= len(local) else 0

    remaining = payload_size - local_size
    seen = set()
    while next_page and remaining > 0 and next_page not in seen:
        seen.add(next_page)
        page = pages.get(next_page)
        if page is None:
            break
        nxt = struct.unpack(">I", page[0:4])[0]
        take = min(remaining, usable - 4)
        out += page[4:4 + take]
        remaining -= take
        next_page = nxt

    return bytes(out)


def iter_records(path: str):
    """Yield (page_number, rowid, values) for every decodable table-leaf cell."""
    raw = open(path, "rb").read()
    if len(raw) < 100:
        return

    page_size = struct.unpack(">H", raw[16:18])[0]
    if page_size == 1:
        page_size = 65536
    reserved = raw[20]
    usable = page_size - reserved

    total_pages = len(raw) // page_size
    pages = {}
    for pno in range(1, total_pages + 1):
        pages[pno] = raw[(pno - 1) * page_size: pno * page_size]

    for pno in range(1, total_pages + 1):
        page = pages[pno]
        header_offset = 100 if pno == 1 else 0
        page_type = page[header_offset]
        if page_type != 0x0D:  # table b-tree leaf
            continue

        cell_count = struct.unpack(">H", page[header_offset + 3:header_offset + 5])[0]
        pointer_base = header_offset + 8

        for i in range(cell_count):
            ptr_off = pointer_base + i * 2
            if ptr_off + 2 > len(page):
                continue
            cell_offset = struct.unpack(">H", page[ptr_off:ptr_off + 2])[0]
            if cell_offset >= len(page):
                continue

            try:
                payload_size, off = read_varint(page, cell_offset)
                rowid, off = read_varint(page, off)

                max_local = usable - 35
                min_local = ((usable - 12) * 32 // 255) - 23
                if payload_size <= max_local:
                    local = page[off:off + payload_size]
                    payload = local
                else:
                    local_size = min_local + (payload_size - min_local) % (usable - 4)
                    if local_size > max_local:
                        local_size = min_local
                    local = page[off:off + local_size + 4]
                    payload = read_overflow(raw, payload_size, local, page_size, pages)

                values = parse_record(payload)
                if values:
                    yield pno, rowid, values
            except Exception:
                continue


if __name__ == "__main__":
    path = sys.argv[1]
    counts = {}
    samples = []
    for pno, rowid, values in iter_records(path):
        if len(values) == 6 and isinstance(values[1], str):
            counts[values[1]] = counts.get(values[1], 0) + 1
            if len(samples) < 5 and values[1] == "chroma:document":
                samples.append((pno, rowid, str(values[2])[:120]))
    print("key counts:")
    for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"   {k:20s} {v}")
    print("\nsamples:")
    for s in samples:
        print("  ", s)
