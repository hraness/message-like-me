# Adapted from hraness/ghostget desktop/distribution/archive.py (MIT).
"""Bounded desktop ZIP protocol. No archive code is imported or executed.

Unsigned input uses our deliberately narrow ZIP writer. Signed input additionally
allows Apple's timestamp extras and AppleDouble companions; only a clean signer
may produce it, and a credential-free verifier performs ditto extraction later.
"""
import os
import pathlib
import stat
import struct
import sys
import unicodedata
import zipfile

MAX_ARCHIVE = 768 * 1024 * 1024
MAX_FILE = 512 * 1024 * 1024
MAX_TOTAL = 1024 * 1024 * 1024
MAX_ENTRIES = 60000


def need(value):
    if not value:
        raise ValueError("Desktop archive violates the bounded ZIP protocol")


def safe_name(name, signed):
    need(isinstance(name, str) and 0 < len(name.encode("utf8")) <= 4096)
    need(unicodedata.normalize("NFC", name) == name and not any(ord(c) < 32 or ord(c) == 127 for c in name))
    need("\\" not in name and ":" not in name and not name.startswith("/"))
    parts = name.rstrip("/").split("/")
    need(len(parts) <= 64 and all(p not in ("", ".", "..") for p in parts))
    if parts[0] == "__MACOSX":
        need(signed and (len(parts) == 1 or parts[1] == "Textbutler.app" or parts[1] == "._Textbutler.app"))
    else:
        need(parts[0] == "Textbutler.app" and all(not p.startswith("._") for p in parts))
    return parts


def extras(raw, signed):
    seen = set()
    while raw:
        need(len(raw) >= 4)
        tag, size = struct.unpack("<HH", raw[:4]); body = raw[4:4 + size]
        need(len(body) == size and tag not in seen and signed)
        # UT timestamps and Info-ZIP UID/GID have no path/link interpretation.
        need(tag in (0x5455, 0x7875, 0x5855))
        if tag == 0x5855:
            need(size in (8, 12))  # Old Info-ZIP Unix: two timestamps, optional uint16 uid/gid.
        elif tag == 0x5455:
            need(size in (5, 9, 13) and body[0] & ~7 == 0)
        else:
            need(size >= 5 and size <= 19 and body[0] == 1 and body[1] in (1, 2, 4, 8))
            gid_offset = 2 + body[1]
            need(gid_offset < size and body[gid_offset] in (1, 2, 4, 8) and gid_offset + 1 + body[gid_offset] == size)
        seen.add(tag); raw = raw[4 + size:]


def inspect(path, signed=False):
    before = os.lstat(path)
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 22 <= before.st_size <= MAX_ARCHIVE)
    with open(path, "rb") as raw:
        need(os.fstat(raw.fileno()).st_ino == before.st_ino)
        raw.seek(-22, 2); tail = raw.read(22)
        magic, disk, central_disk, disk_count, count, central_size, central_offset, comment = struct.unpack("<4s4H2IH", tail)
        need(magic == b"PK\x05\x06" and disk == central_disk == comment == 0 and disk_count == count and 1 <= count <= MAX_ENTRIES)
        need(0 < central_size <= 64 * 1024 * 1024 and central_offset + central_size + 22 == before.st_size)
        with zipfile.ZipFile(raw) as archive:
            entries = archive.infolist(); need(len(entries) == count)
            names = {}; folded = set(); total = 0; offset = 0
            for entry in entries:
                parts = safe_name(entry.filename, signed); name = entry.filename.rstrip("/")
                key = name.casefold(); need(key not in folded); folded.add(key)
                mode = entry.external_attr >> 16
                directory = entry.is_dir()
                need(entry.create_system == 3 and entry.extract_version <= 20 and entry.volume == 0)
                need(stat.S_IFMT(mode) == (stat.S_IFDIR if directory else stat.S_IFREG) and mode & 0o7000 == 0)
                low = entry.external_attr & 0xffff
                need(low in ((0, 0x10, 0x4000) if signed else (0, 0x10)))
                need(low == 0x4000 or bool(low & 0x10) == directory)
                need(entry.flag_bits & ~(0x800 | (8 if signed else 0)) == 0 and entry.compress_type in (0, 8) and not entry.comment)
                need(0 <= entry.file_size <= MAX_FILE and 0 <= entry.compress_size <= MAX_ARCHIVE)
                need(not directory or entry.file_size == 0)
                total += entry.file_size; need(total <= MAX_TOTAL)
                extras(entry.extra, signed)
                need(entry.header_offset == offset)
                raw.seek(offset); header = raw.read(30); need(len(header) == 30)
                magic, needed, flags, method, tm, date, crc, packed, size, name_len, extra_len = struct.unpack("<4s5H3I2H", header)
                need(magic == b"PK\x03\x04" and needed == entry.extract_version and flags == entry.flag_bits and method == entry.compress_type)
                encoded = entry.filename.encode("utf8" if flags & 0x800 else "cp437")
                need(raw.read(name_len) == encoded); extras(raw.read(extra_len), signed)
                if flags & 8:
                    need((crc, packed, size) in ((0, 0, 0), (entry.CRC, entry.compress_size, entry.file_size)))
                else:
                    need((crc, packed, size) == (entry.CRC, entry.compress_size, entry.file_size))
                offset += 30 + name_len + extra_len + entry.compress_size
                if flags & 8:
                    raw.seek(offset); descriptor = raw.read(16)
                    need(len(descriptor) == 16 and struct.unpack("<4s3I", descriptor) == (b"PK\x07\x08", entry.CRC, entry.compress_size, entry.file_size)); offset += 16
                need(offset <= central_offset)
                names[name] = directory
                # Read every byte now: zipfile checks the local name, overlapping entries and CRC.
                actual = 0
                with archive.open(entry) as content:
                    while chunk := content.read(1024 * 1024):
                        actual += len(chunk); need(actual <= entry.file_size)
                need(actual == entry.file_size)
            need(offset == central_offset and names.get("Textbutler.app") is True)
            for name, directory in names.items():
                parts = name.split("/")
                for i in range(1, len(parts)):
                    need(names.get("/".join(parts[:i])) is True)
                if parts[0] == "__MACOSX" and not directory:
                    need(parts[-1].startswith("._") and len(parts[-1]) > 2)
                    target = "/".join(parts[1:-1] + [parts[-1][2:]])
                    need(target in names and target.startswith("Textbutler.app"))
    after = os.lstat(path)
    need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns))
    return entries


def pack(app, destination):
    app = pathlib.Path(app)
    need(app.name == "Textbutler.app" and not app.is_symlink() and app.is_dir())
    paths = [app] + sorted(app.rglob("*"))
    need(len(paths) <= MAX_ENTRIES)
    total = 0
    with zipfile.ZipFile(destination, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=False) as archive:
        for path in paths:
            s = path.lstat(); directory = stat.S_ISDIR(s.st_mode)
            need(s.st_mode & 0o7000 == 0)
            need(directory or stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and s.st_size <= MAX_FILE)
            total += 0 if directory else s.st_size; need(total <= MAX_TOTAL)
            name = path.relative_to(app.parent).as_posix() + ("/" if directory else "")
            safe_name(name, False)
            info = zipfile.ZipInfo(name); info.create_system = 3
            info.external_attr = ((stat.S_IFDIR | 0o755) if directory else (stat.S_IFREG | (0o755 if s.st_mode & 0o111 else 0o644))) << 16
            if directory: info.external_attr |= 0x10
            info.compress_type = zipfile.ZIP_STORED if directory else zipfile.ZIP_DEFLATED
            # Streaming writes stay below ZIP64; our bounded per-file size is supplied up front.
            info.file_size = 0 if directory else s.st_size
            with archive.open(info, "w") as output:
                if not directory:
                    with open(path, "rb") as source:
                        while chunk := source.read(1024 * 1024): output.write(chunk)
    inspect(destination)


def extract(path, destination):
    entries = inspect(path)
    root = pathlib.Path(destination)
    need(root.is_dir() and not root.is_symlink() and not list(root.iterdir()))
    with zipfile.ZipFile(path) as archive:
        for entry in entries:
            target = root.joinpath(*entry.filename.rstrip("/").split("/"))
            if entry.is_dir():
                target.mkdir(mode=0o755); target.chmod(0o755)
            else:
                with target.open("xb") as output, archive.open(entry) as source:
                    while chunk := source.read(1024 * 1024): output.write(chunk)
                target.chmod((entry.external_attr >> 16) & 0o755)


if __name__ == "__main__":
    try:
        need(len(sys.argv) in (3, 4))
        if sys.argv[1] == "pack" and len(sys.argv) == 4: pack(sys.argv[2], sys.argv[3])
        elif sys.argv[1] == "unsigned" and len(sys.argv) == 4: extract(sys.argv[2], sys.argv[3])
        elif sys.argv[1] == "signed" and len(sys.argv) == 3: inspect(sys.argv[2], True)
        else: need(False)
    except Exception:
        sys.exit("Desktop archive validation failed; no archive code was executed")
