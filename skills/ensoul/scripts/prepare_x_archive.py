#!/usr/bin/env python3
"""Prepare a bounded Ensoul source packet from account-authored X posts.

Only allowlisted public-post members are opened. Direct messages, address books,
advertising data, media, and every other archive member remain unread.
"""

from __future__ import annotations

import argparse
import datetime as dt
import email.utils
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import uuid
import zipfile


SCHEMA_VERSION = "ensoul.source-packet.v1"
PAYLOAD_SCHEMA = "ensoul.x-authored-posts-source.v1"
MAX_ARCHIVE_MEMBERS = 100_000
MAX_SELECTED_MEMBER_BYTES = 256 * 1024 * 1024
MAX_SELECTED_TOTAL_BYTES = 512 * 1024 * 1024
MAX_COMPRESSION_RATIO = 1_000
MAX_POSTS = 2_000
MAX_TEXT_CHARS = 50_000
MAX_RECORD_CONTENT_BYTES = 32 * 1024
MAX_TOTAL_CONTENT_BYTES = MAX_POSTS * MAX_RECORD_CONTENT_BYTES
MAX_PACKET_BYTES = 128 * 1024 * 1024
TWEET_MEMBER = re.compile(r"(?:^|/)data/tweets(?:-part\d+)?\.js$")
POST_ID = re.compile(r"^[0-9]{1,20}$", re.ASCII)
JS_PREFIX = re.compile(
    r"^\s*(?:window\.)?YTD\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\s*=\s*",
    re.ASCII,
)


class ArchiveError(ValueError):
    pass


def canonical_bytes(value: object) -> bytes:
    """Encode the packet's JSON subset according to RFC 8785 JCS."""

    def encode(item: object) -> str:
        if item is None:
            return "null"
        if item is True:
            return "true"
        if item is False:
            return "false"
        if isinstance(item, int):
            if abs(item) > 9_007_199_254_740_991:
                raise ArchiveError("integer exceeds the interoperable JSON range")
            return str(item)
        if isinstance(item, float):
            raise ArchiveError("floating-point values are not supported in source packets")
        if isinstance(item, str):
            if any(0xD800 <= ord(character) <= 0xDFFF for character in item):
                raise ArchiveError("unpaired Unicode surrogate in source packet")
            return json.dumps(item, ensure_ascii=False, separators=(",", ":"))
        if isinstance(item, list):
            return "[" + ",".join(encode(member) for member in item) + "]"
        if isinstance(item, dict):
            if not all(isinstance(key, str) for key in item):
                raise ArchiveError("source packet object keys must be strings")
            keys = sorted(item, key=lambda key: key.encode("utf-16be"))
            return "{" + ",".join(f"{encode(key)}:{encode(item[key])}" for key in keys) + "}"
        raise ArchiveError(f"unsupported source packet value: {type(item).__name__}")

    return encode(value).encode("utf-8")


def sha256_hex(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def parse_bound(value: str | None, flag: str) -> dt.datetime | None:
    if value is None:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ArchiveError(f"{flag} must be an ISO-8601 timestamp") from exc
    if parsed.tzinfo is None:
        raise ArchiveError(f"{flag} must include a timezone")
    return parsed.astimezone(dt.timezone.utc)


def parse_created_at(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError):
        try:
            parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def validate_member(info: zipfile.ZipInfo) -> None:
    name = info.filename
    if "\\" in name or "\x00" in name:
        raise ArchiveError("archive contains an unsafe member name")
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        raise ArchiveError("archive contains a path-traversal member")
    unix_type = (info.external_attr >> 16) & 0o170000
    if unix_type == stat.S_IFLNK:
        raise ArchiveError("archive contains a symbolic-link member")


def selected_members(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    infos = archive.infolist()
    if len(infos) > MAX_ARCHIVE_MEMBERS:
        raise ArchiveError("archive has too many members")
    selected: list[zipfile.ZipInfo] = []
    names: set[str] = set()
    total = 0
    for info in infos:
        validate_member(info)
        if not TWEET_MEMBER.search(info.filename):
            continue
        if info.filename in names:
            raise ArchiveError("archive contains a duplicate posts member")
        names.add(info.filename)
        if info.file_size > MAX_SELECTED_MEMBER_BYTES:
            raise ArchiveError("posts member exceeds the safety limit")
        ratio = info.file_size / max(info.compress_size, 1)
        if ratio > MAX_COMPRESSION_RATIO:
            raise ArchiveError("posts member has an unsafe compression ratio")
        total += info.file_size
        if total > MAX_SELECTED_TOTAL_BYTES:
            raise ArchiveError("combined posts members exceed the safety limit")
        selected.append(info)
    if not selected:
        raise ArchiveError("archive contains no supported data/tweets*.js member")
    return sorted(selected, key=lambda item: item.filename)


def read_bounded(archive: zipfile.ZipFile, info: zipfile.ZipInfo) -> bytes:
    with archive.open(info, "r") as member:
        data = member.read(info.file_size + 1)
    if len(data) != info.file_size:
        raise ArchiveError("posts member size changed while reading")
    return data


def parse_js_array(data: bytes, member_name: str) -> list[object]:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ArchiveError(f"{member_name} is not UTF-8") from exc
    prefix = JS_PREFIX.match(text)
    if prefix is None:
        raise ArchiveError(f"{member_name} has an unsupported JavaScript wrapper")
    payload = text[prefix.end() :].strip()
    if payload.endswith(";"):
        payload = payload[:-1].rstrip()
    try:
        value = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ArchiveError(f"{member_name} does not contain valid JSON") from exc
    if not isinstance(value, list):
        raise ArchiveError(f"{member_name} must contain an array")
    return value


def classify_post(tweet: dict[str, object], text: str) -> tuple[str, str]:
    if text.startswith("RT @"):
        return "repost", "mixed"
    if tweet.get("in_reply_to_status_id") or tweet.get("in_reply_to_status_id_str"):
        return "reply", "subject"
    if tweet.get("quoted_status_id") or tweet.get("quoted_status_id_str"):
        return "quote_post", "subject"
    return "post", "subject"


def bounded_content(text: str) -> dict[str, object]:
    candidate = text[:MAX_TEXT_CHARS]
    truncated = len(candidate) != len(text)

    def content(prefix: str, was_truncated: bool) -> dict[str, object]:
        return {"text": prefix, "truncated": was_truncated}

    if len(canonical_bytes(content(candidate, truncated))) <= MAX_RECORD_CONTENT_BYTES:
        return content(candidate, truncated)
    low = 0
    high = len(candidate)
    while low < high:
        middle = (low + high + 1) // 2
        if len(canonical_bytes(content(candidate[:middle], True))) <= MAX_RECORD_CONTENT_BYTES:
            low = middle
        else:
            high = middle - 1
    return content(candidate[:low], True)


def post_record(raw: object, member_name: str) -> dict[str, object] | None:
    if not isinstance(raw, dict):
        return None
    candidate = raw.get("tweet", raw)
    if not isinstance(candidate, dict):
        return None
    post_id = candidate.get("id_str", candidate.get("id"))
    text = candidate.get("full_text", candidate.get("text"))
    if not isinstance(post_id, (str, int)) or not isinstance(text, str):
        return None
    post_id_text = str(post_id).strip()
    if POST_ID.fullmatch(post_id_text) is None or not text.strip():
        return None
    content = bounded_content(text)
    bounded_text = str(content["text"])
    kind, author_role = classify_post(candidate, bounded_text)
    occurred_at = parse_created_at(candidate.get("created_at"))
    if occurred_at is None:
        return None
    content_hash = sha256_hex(canonical_bytes(content))
    semantic: dict[str, object] = {
        "id": f"x:{post_id_text}",
        "kind": kind,
        "authorRole": author_role,
        "contentRole": "forwarded" if kind == "repost" else "original",
        "authorshipConfidence": "strong",
        "sentStatus": "published",
        "visibility": "public",
        "sourceClass": "polished_self_presentation",
        "content": content,
        "provenance": {
            "provider": "x-archive",
            "operation": "account-authored-public-post-export",
            "sourceId": f"x-post:{post_id_text}",
            "policyVersion": PAYLOAD_SCHEMA,
            "contentSha256": content_hash,
        },
    }
    semantic["occurredAt"] = occurred_at
    semantic["digest"] = "sha256:" + sha256_hex(canonical_bytes(semantic))
    semantic["_member"] = member_name
    return semantic


def choose_evenly(records: list[dict[str, object]], limit: int) -> list[dict[str, object]]:
    if len(records) <= limit:
        return records
    if limit == 1:
        return [records[-1]]
    indexes = [round(index * (len(records) - 1) / (limit - 1)) for index in range(limit)]
    return [records[index] for index in indexes]


def build_packet(
    archive_path: Path,
    *,
    limit: int,
    after: dt.datetime | None,
    before: dt.datetime | None,
) -> tuple[dict[str, object], dict[str, object]]:
    selected_hash = hashlib.sha256()
    records: list[dict[str, object]] = []
    malformed = 0
    duplicate_ids = 0
    input_records = 0
    selected_member_count = 0
    with zipfile.ZipFile(archive_path, "r") as archive:
        members = selected_members(archive)
        selected_member_count = len(members)
        for info in members:
            data = read_bounded(archive, info)
            selected_hash.update(info.filename.encode("utf-8"))
            selected_hash.update(b"\x00")
            selected_hash.update(data)
            raw_records = parse_js_array(data, info.filename)
            input_records += len(raw_records)
            for raw in raw_records:
                record = post_record(raw, info.filename)
                if record is None:
                    malformed += 1
                    continue
                records.append(record)

    by_id: dict[str, dict[str, object]] = {}
    for record in records:
        record_id = str(record["id"])
        if record_id in by_id:
            previous = dict(by_id[record_id])
            current = dict(record)
            previous.pop("_member", None)
            current.pop("_member", None)
            if previous != current:
                raise ArchiveError("archive contains conflicting records for one post ID")
            duplicate_ids += 1
            continue
        by_id[record_id] = record
    records = list(by_id.values())
    records.sort(key=lambda value: (str(value.get("occurredAt", "")), str(value["id"])))

    def in_bounds(record: dict[str, object]) -> bool:
        value = record.get("occurredAt")
        if not isinstance(value, str):
            return after is None and before is None
        timestamp = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        if after is not None and timestamp < after:
            return False
        if before is not None and timestamp >= before:
            return False
        return True

    records = [record for record in records if in_bounds(record)]
    eligible_count = len(records)
    records = choose_evenly(records, limit)
    for record in records:
        record.pop("_member", None)

    content_bytes = sum(len(canonical_bytes(record["content"])) for record in records)
    if content_bytes > MAX_TOTAL_CONTENT_BYTES:
        raise ArchiveError("selected post content exceeds the aggregate safety limit")

    revision = selected_hash.hexdigest()
    generated_at = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    latest = max((str(record.get("occurredAt")) for record in records if record.get("occurredAt")), default=None)
    if latest is not None and dt.datetime.fromisoformat(latest.replace("Z", "+00:00")) > dt.datetime.fromisoformat(
        generated_at.replace("Z", "+00:00")
    ):
        raise ArchiveError("selected posts contain an occurrence time later than packet generation")
    limits: dict[str, object] = {
        "maxRecords": limit,
        "eligibleRecords": eligible_count,
        "selection": "chronological-even-sample",
        "afterInclusive": after.isoformat().replace("+00:00", "Z") if after else None,
        "beforeExclusive": before.isoformat().replace("+00:00", "Z") if before else None,
        "contentBytes": content_bytes,
        "maxContentBytes": MAX_TOTAL_CONTENT_BYTES,
        "selectedMembers": selected_member_count,
        "inputRecords": input_records,
        "malformedRecordsSkipped": malformed,
        "exactDuplicateRecordsSkipped": duplicate_ids,
    }
    packet: dict[str, object] = {
        "schemaVersion": SCHEMA_VERSION,
        "digestCanonicalization": "JCS-RFC8785",
        "packetId": f"ensoul_x_{revision[:24]}",
        "generatedAt": generated_at,
        "subject": {
            "localId": f"x-archive-owner:{revision[:16]}",
            "kind": "owner",
            "identityBasis": "User-authorized official account archive; the user must confirm archive ownership.",
        },
        "scope": {
            "adapter": "x-archive",
            "payloadSchema": PAYLOAD_SCHEMA,
            "completeness": (
                "sampled" if eligible_count > limit
                else "bounded" if malformed > 0 or duplicate_ids > 0
                else "complete"
            ),
            "sourceRevision": "sha256:" + revision,
            "limits": limits,
        },
        "records": records,
        "limitations": [
            "Only allowlisted data/tweets*.js members were opened; direct messages, address books, advertising data, media, deleted posts, and community posts were not accessed.",
            "Archive membership supports account authorship but does not prove that every embedded or quoted phrase was written by the subject; reposts are marked mixed.",
            "Public visibility describes the original post context and is not permission to republish content that may since have been deleted or restricted.",
            "Selection is bounded and chronological; counts do not measure importance, motive, or stable personality.",
        ],
    }
    if latest:
        packet["scope"]["sourceCutoff"] = latest  # type: ignore[index]
    packet["packetDigest"] = "sha256:" + sha256_hex(canonical_bytes(packet))
    receipt = {
        "schemaVersion": SCHEMA_VERSION,
        "packetDigest": packet["packetDigest"],
        "records": len(records),
        "eligibleRecords": eligible_count,
        "malformedRecordsSkipped": malformed,
        "duplicateIdsSkipped": duplicate_ids,
        "contentBytes": content_bytes,
        "maxContentBytes": MAX_TOTAL_CONTENT_BYTES,
        "selectedMembers": selected_member_count,
        "inputRecords": input_records,
        "exactDuplicateRecordsSkipped": duplicate_ids,
        "sourceRevision": packet["scope"]["sourceRevision"],  # type: ignore[index]
    }
    return packet, receipt


def write_private_atomic(path: Path, data: bytes) -> None:
    if not path.is_absolute():
        raise ArchiveError("--output must be an absolute path")
    parent = path.parent
    resolved_parent = parent.resolve(strict=True)
    if resolved_parent != parent:
        raise ArchiveError("--output parent must not contain symbolic links")
    if path.exists() or path.is_symlink():
        raise ArchiveError("--output already exists")
    temp = parent / f".{path.name}.tmp-{uuid.uuid4().hex}"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(temp, flags, 0o600)
    try:
        with os.fdopen(descriptor, "wb", closefd=True) as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temp, 0o600)
        os.link(temp, path, follow_symlinks=False)
        directory = os.open(parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        try:
            temp.unlink()
        except FileNotFoundError:
            pass


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="absolute path to an official X archive ZIP")
    parser.add_argument("--output", required=True, type=Path, help="new absolute private packet path")
    parser.add_argument("--limit", type=int, default=2000, help="maximum evenly sampled posts (default: 2000)")
    parser.add_argument("--after", help="inclusive ISO-8601 timestamp")
    parser.add_argument("--before", help="exclusive ISO-8601 timestamp")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        if not args.archive.is_absolute():
            raise ArchiveError("archive path must be absolute")
        if not args.archive.is_file():
            raise ArchiveError("archive path must be an existing file")
        if args.limit < 1 or args.limit > MAX_POSTS:
            raise ArchiveError(f"--limit must be between 1 and {MAX_POSTS}")
        after = parse_bound(args.after, "--after")
        before = parse_bound(args.before, "--before")
        if after and before and after >= before:
            raise ArchiveError("--after must be earlier than --before")
        packet, receipt = build_packet(args.archive, limit=args.limit, after=after, before=before)
        payload = json.dumps(packet, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
        if len(payload) > MAX_PACKET_BYTES:
            raise ArchiveError("prepared packet exceeds the 128 MiB output safety limit")
        write_private_atomic(args.output, payload)
        receipt["output"] = str(args.output)
        print(json.dumps(receipt, sort_keys=True, separators=(",", ":")))
        return 0
    except (ArchiveError, OSError, zipfile.BadZipFile) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
