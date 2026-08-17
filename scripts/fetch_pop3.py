#!/usr/bin/env python3
"""Fetch matching POP3 mail, translate EN→JA, and write data/ without deleting server mail."""

from __future__ import annotations

import hashlib
import json
import os
import poplib
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from email import policy
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.parser import BytesParser
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
EMAILS_DIR = DATA_DIR / "emails"
INDEX_PATH = DATA_DIR / "index.json"
SETTINGS_PATH = DATA_DIR / "settings.json"
SEEN_PATH = DATA_DIR / "seen.json"

TRANSLATE_CHUNK = 4000
TRANSLATE_LIMIT = 20000


def log(message: str) -> None:
    print(message, flush=True)


def env_bool(name: str, default: bool = True) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def load_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def decode_mime_header(value: str | None) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def uid_filename(uid: str) -> str:
    digest = hashlib.sha256(uid.encode("utf-8")).hexdigest()
    return f"{digest}.json"


def sender_matches(from_addr: str, filt: str) -> bool:
    parts = [p.strip().lower() for p in filt.split(",") if p.strip()]
    if not parts:
        return False
    haystack = from_addr.lower()
    return any(part in haystack for part in parts)


def extract_addresses(msg: EmailMessage) -> str:
    return decode_mime_header(msg.get("From", ""))


def get_body(msg: EmailMessage) -> tuple[str, str]:
    text_parts: list[str] = []
    html_parts: list[str] = []

    for part in msg.walk():
        if part.get_content_maintype() == "multipart":
            continue
        disposition = str(part.get("Content-Disposition") or "")
        if "attachment" in disposition.lower():
            continue
        ctype = part.get_content_type()
        try:
            payload = part.get_content()
        except Exception:
            raw = part.get_payload(decode=True) or b""
            charset = part.get_content_charset() or "utf-8"
            payload = raw.decode(charset, errors="replace")
        if not isinstance(payload, str):
            continue
        if ctype == "text/plain":
            text_parts.append(payload)
        elif ctype == "text/html":
            html_parts.append(payload)

    text = "\n\n".join(p.strip() for p in text_parts if p.strip())
    html = "\n".join(html_parts)
    if not text and html:
        text = html_to_text(html)
    return text.strip(), html.strip()


def html_to_text(html: str) -> str:
    cleaned = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", html)
    cleaned = re.sub(r"(?i)<br\s*/?>", "\n", cleaned)
    cleaned = re.sub(r"(?i)</p>", "\n\n", cleaned)
    cleaned = re.sub(r"(?s)<[^>]+>", " ", cleaned)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def translate_chunk(text: str) -> str:
    query = urllib.parse.urlencode(
        {"client": "gtx", "sl": "en", "tl": "ja", "dt": "t", "q": text},
        encoding="utf-8",
    )
    url = "https://translate.googleapis.com/translate_a/single?" + query
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "mail-stream-viewer2"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    pieces = payload[0] if payload else []
    return "".join(item[0] for item in pieces if item and item[0])


def translate_en_ja(text: str) -> str:
    source = (text or "").strip()
    if not source:
        return ""
    clipped = source[:TRANSLATE_LIMIT]
    chunks: list[str] = []
    rest = clipped
    while rest:
        piece = rest[:TRANSLATE_CHUNK]
        cut = piece.rfind("\n")
        if cut > TRANSLATE_CHUNK // 2:
            piece = piece[:cut]
        chunks.append(piece)
        rest = rest[len(piece) :].lstrip()

    translated: list[str] = []
    for i, chunk in enumerate(chunks):
        try:
            translated.append(translate_chunk(chunk))
            if i < len(chunks) - 1:
                time.sleep(0.4)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ssl.SSLError) as exc:
            log(f"translation failed: {type(exc).__name__}")
            return ""
    return "".join(translated).strip()


def connect_pop3() -> poplib.POP3:
    host = os.environ.get("POP3_HOST", "").strip()
    user = os.environ.get("POP3_USER", "").strip()
    password = os.environ.get("POP3_PASSWORD", "")
    port_raw = os.environ.get("POP3_PORT", "995").strip() or "995"
    port = int(port_raw)
    use_ssl = env_bool("POP3_SSL", True)

    if not host or not user or not password:
        raise SystemExit("POP3_HOST, POP3_USER, and POP3_PASSWORD are required")

    if use_ssl:
        pop = poplib.POP3_SSL(host, port, timeout=60)
    else:
        pop = poplib.POP3(host, port, timeout=60)
    pop.user(user)
    pop.pass_(password)
    return pop


def parse_uidl(pop: poplib.POP3) -> list[tuple[int, str]]:
    _resp, items, _octets = pop.uidl()
    result: list[tuple[int, str]] = []
    for item in items:
        line = item.decode("utf-8", errors="replace").strip()
        num_str, uid = line.split(None, 1)
        result.append((int(num_str), uid))
    return result


def main() -> int:
    settings = load_json(SETTINGS_PATH, {"senderFilter": "", "zoom": 100, "displayLang": "ja"})
    sender_filter = str(settings.get("senderFilter") or "")
    if not sender_filter.strip():
        log("senderFilter is empty; skip fetch to avoid downloading the whole mailbox")
        return 0

    index = load_json(INDEX_PATH, {"emails": []})
    emails: list[dict[str, Any]] = list(index.get("emails") or [])
    known = {item["uid"]: item for item in emails if "uid" in item}
    seen = set(load_json(SEEN_PATH, {"uids": []}).get("uids") or [])

    pop = connect_pop3()
    added = 0
    skipped = 0
    try:
        listings = parse_uidl(pop)
        log(f"server has {len(listings)} messages")
        for num, uid in listings:
            if uid in known or uid in seen:
                skipped += 1
                continue
            _resp, lines, _octets = pop.retr(num)
            raw = b"\r\n".join(lines)
            msg = BytesParser(policy=policy.default).parsebytes(raw)
            from_addr = extract_addresses(msg)
            seen.add(uid)
            if not sender_matches(from_addr, sender_filter):
                continue
            subject = decode_mime_header(msg.get("Subject"))
            date = decode_mime_header(msg.get("Date"))
            body_text, body_html = get_body(msg)
            subject_ja = translate_en_ja(subject)
            body_text_ja = translate_en_ja(body_text)
            record = {
                "uid": uid,
                "from_addr": from_addr,
                "subject": subject,
                "subject_ja": subject_ja,
                "date": date,
                "body_text": body_text,
                "body_text_ja": body_text_ja,
                "body_html": body_html,
                "is_read": False,
            }
            filename = uid_filename(uid)
            write_json(EMAILS_DIR / filename, record)
            emails.append(
                {
                    "id": filename[:-5],
                    "uid": uid,
                    "from_addr": from_addr,
                    "subject": subject,
                    "subject_ja": subject_ja,
                    "date": date,
                    "is_read": False,
                    "file": filename,
                }
            )
            known[uid] = emails[-1]
            added += 1
            log(f"saved uid={uid[:24]} from={from_addr}")
    finally:
        try:
            pop.quit()
        except Exception:
            pass

    emails.sort(key=lambda item: item.get("date") or "", reverse=True)
    write_json(INDEX_PATH, {"emails": emails})
    write_json(SEEN_PATH, {"uids": sorted(seen)})
    log(f"done added={added} already_known={skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
