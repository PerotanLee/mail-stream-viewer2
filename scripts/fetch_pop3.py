#!/usr/bin/env python3
"""Fetch matching POP3 mail from the last 7 days, translate EN→JA, leave server mail in place."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import poplib
import re
import ssl
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from email import policy
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
EMAILS_DIR = DATA_DIR / "emails"
INDEX_PATH = DATA_DIR / "index.json"
SETTINGS_PATH = DATA_DIR / "settings.json"
SEEN_PATH = DATA_DIR / "seen.json"
LAST_RUN_PATH = DATA_DIR / "last-run.json"

TRANSLATE_CHUNK = 4000
TRANSLATE_LIMIT = 20000
MAX_AGE = timedelta(days=7)
OLD_STREAK_STOP = 15
MAX_SCAN = 200
poplib._MAXLINE = 20 * 1024 * 1024


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


_last_publish = 0.0
_last_sha: str | None = None


def github_file_sha(url: str, headers: dict[str, str], branch: str) -> str | None:
    req = urllib.request.Request(f"{url}?ref={urllib.parse.quote(branch)}", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        return str(payload.get("sha") or "") or None
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def publish_progress_remote(payload: dict[str, Any]) -> None:
    global _last_sha
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    repo = os.environ.get("GITHUB_REPOSITORY", "").strip()
    branch = os.environ.get("GITHUB_REF_NAME", "").strip() or "main"
    if not token or not repo:
        return
    url = f"https://api.github.com/repos/{repo}/contents/data/last-run.json"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "mail-stream-viewer2",
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    body: dict[str, Any] = {
        "message": "Update fetch progress",
        "content": base64.b64encode(text.encode("utf-8")).decode("ascii"),
        "branch": branch,
    }
    sha = _last_sha or github_file_sha(url, headers, branch)
    if sha:
        body["sha"] = sha
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        method="PUT",
        headers={**headers, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        _last_sha = str((result.get("content") or {}).get("sha") or "") or _last_sha
    except urllib.error.HTTPError as exc:
        if exc.code != 409:
            log(f"progress publish failed: {exc.code}")
            return
        _last_sha = github_file_sha(url, headers, branch)
        if _last_sha:
            body["sha"] = _last_sha
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            method="PUT",
            headers={**headers, "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        _last_sha = str((result.get("content") or {}).get("sha") or "") or _last_sha


def write_run_report(
    *,
    ok: bool,
    step: str,
    phase: str = "",
    running: bool = False,
    error: str = "",
    trace: str = "",
    extra: dict[str, Any] | None = None,
    force: bool = False,
) -> None:
    global _last_publish
    now = datetime.now(timezone.utc).isoformat()
    payload: dict[str, Any] = {
        "ok": ok,
        "running": running,
        "step": step,
        "phase": phase or step,
        "error": error,
        "traceback": trace[-8000:] if trace else "",
        "updated_at": now,
    }
    if not running:
        payload["finished_at"] = now
    if extra:
        payload.update(extra)
    write_json(LAST_RUN_PATH, payload)
    elapsed = time.time() - _last_publish
    if running and not force and elapsed < 4:
        return
    _last_publish = time.time()
    try:
        publish_progress_remote(payload)
    except Exception as exc:
        log(f"progress publish skipped: {exc}")


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


def parse_message_date(msg: EmailMessage) -> datetime | None:
    raw = decode_mime_header(msg.get("Date"))
    if not raw:
        return None
    try:
        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def is_recent(dt: datetime | None, cutoff: datetime) -> bool:
    if dt is None:
        return True
    return dt >= cutoff


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
            detail = getattr(exc, "code", None) or str(exc)
            log(f"translation failed: {type(exc).__name__} {detail}")
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
        raise RuntimeError("POP3_HOST / POP3_USER / POP3_PASSWORD が空です。設定画面から保存してください。")

    log(f"POP3 connect host={host} port={port} ssl={use_ssl} user={user}")
    if use_ssl:
        pop = poplib.POP3_SSL(host, port, timeout=90)
    else:
        pop = poplib.POP3(host, port, timeout=90)
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


def fetch_headers(pop: poplib.POP3, num: int) -> EmailMessage:
    _resp, lines, _octets = pop.top(num, 0)
    raw = b"\r\n".join(lines)
    return BytesParser(policy=policy.default).parsebytes(raw)


def fetch_full(pop: poplib.POP3, num: int) -> EmailMessage:
    _resp, lines, _octets = pop.retr(num)
    raw = b"\r\n".join(lines)
    return BytesParser(policy=policy.default).parsebytes(raw)


def main() -> int:
    step = "開始"
    extra: dict[str, Any] = {
        "added": 0,
        "skipped": 0,
        "server_count": 0,
        "scanned": 0,
        "scan_total": 0,
        "current": "",
    }
    pop: poplib.POP3 | None = None
    try:
        step = "設定読み込み"
        write_run_report(ok=False, running=True, step=step, phase="setup", extra=extra, force=True)
        settings = load_json(SETTINGS_PATH, {"senderFilter": "", "zoom": 100, "displayLang": "ja"})
        sender_filter = str(settings.get("senderFilter") or "")
        if not sender_filter.strip():
            log("senderFilter is empty; skip fetch")
            write_run_report(ok=True, step="送信元フィルタが空のため取得スキップ", phase="skip", extra=extra, force=True)
            return 0

        index = load_json(INDEX_PATH, {"emails": []})
        emails: list[dict[str, Any]] = list(index.get("emails") or [])
        known = {item["uid"]: item for item in emails if "uid" in item}
        seen = set(load_json(SEEN_PATH, {"uids": []}).get("uids") or [])
        cutoff = datetime.now(timezone.utc) - MAX_AGE
        log(f"only mail since {cutoff.isoformat()} (7 days)")

        step = "POP3接続"
        write_run_report(ok=False, running=True, step=step, phase="connect", extra=extra, force=True)
        pop = connect_pop3()
        added = 0
        skipped = 0
        old_streak = 0

        step = "UIDL一覧"
        write_run_report(ok=False, running=True, step=step, phase="uidl", extra=extra, force=True)
        listings = parse_uidl(pop)
        extra["server_count"] = len(listings)
        newest = listings[-MAX_SCAN:]
        extra["scan_total"] = len(newest)
        log(f"server has {len(listings)} messages; scanning newest {len(newest)}")
        write_run_report(ok=False, running=True, step=step, phase="uidl", extra=extra, force=True)

        for num, uid in reversed(newest):
            extra["scanned"] = int(extra.get("scanned") or 0) + 1
            extra["added"] = added
            extra["skipped"] = skipped
            if uid in known or uid in seen:
                skipped += 1
                extra["skipped"] = skipped
                extra["current"] = "既読または取得済みをスキップ"
                write_run_report(ok=False, running=True, step="スキャン", phase="scan", extra=extra)
                continue
            step = f"ヘッダー取得 num={num}"
            extra["current"] = f"ヘッダー確認 #{num}"
            write_run_report(ok=False, running=True, step=step, phase="scan", extra=extra)
            try:
                headers = fetch_headers(pop, num)
            except poplib.error_proto as exc:
                log(f"skip num={num} header error: {exc}")
                seen.add(uid)
                skipped += 1
                extra["skipped"] = skipped
                continue

            from_addr = extract_addresses(headers)
            msg_date = parse_message_date(headers)
            if not is_recent(msg_date, cutoff):
                seen.add(uid)
                skipped += 1
                extra["skipped"] = skipped
                extra["current"] = "7日より前のためスキップ"
                old_streak += 1
                write_run_report(ok=False, running=True, step="スキャン", phase="scan", extra=extra)
                if old_streak >= OLD_STREAK_STOP:
                    log(f"stop scan: {OLD_STREAK_STOP} consecutive messages older than 7 days")
                    break
                continue
            old_streak = 0

            if not sender_matches(from_addr, sender_filter):
                seen.add(uid)
                skipped += 1
                extra["skipped"] = skipped
                extra["current"] = "送信元フィルタ外をスキップ"
                write_run_report(ok=False, running=True, step="スキャン", phase="scan", extra=extra)
                continue

            step = f"本文取得 num={num} from={from_addr}"
            extra["current"] = from_addr
            write_run_report(ok=False, running=True, step=step, phase="retr", extra=extra, force=True)
            try:
                msg = fetch_full(pop, num)
            except poplib.error_proto as exc:
                log(f"skip num={num} retr error: {exc}")
                seen.add(uid)
                skipped += 1
                extra["skipped"] = skipped
                continue

            from_addr = extract_addresses(msg) or from_addr
            subject = decode_mime_header(msg.get("Subject"))
            date = decode_mime_header(msg.get("Date"))
            body_text, body_html = get_body(msg)
            record = {
                "uid": uid,
                "from_addr": from_addr,
                "subject": subject,
                "subject_ja": "",
                "date": date,
                "body_text": body_text,
                "body_text_ja": "",
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
                    "subject_ja": "",
                    "date": date,
                    "is_read": False,
                    "file": filename,
                }
            )
            known[uid] = emails[-1]
            seen.add(uid)
            added += 1
            extra["added"] = added
            extra["current"] = subject or from_addr
            write_run_report(ok=False, running=True, step="本文保存", phase="retr", extra=extra, force=True)
            log(f"saved uid={uid[:24]} from={from_addr} date={date}")

        extra["added"] = added
        extra["skipped"] = skipped
        extra["current"] = ""
        step = "保存"
        write_run_report(ok=False, running=True, step=step, phase="save", extra=extra, force=True)
        emails.sort(key=lambda item: item.get("date") or "", reverse=True)
        write_json(INDEX_PATH, {"emails": emails})
        write_json(SEEN_PATH, {"uids": sorted(seen)})
        write_run_report(ok=True, step="完了", phase="done", extra=extra, force=True)
        log(f"done added={added} skipped={skipped} server={len(listings)}")
        return 0
    except Exception as exc:
        trace = traceback.format_exc()
        log(f"ERROR step={step}: {type(exc).__name__}: {exc}")
        log(trace)
        extra["error_type"] = type(exc).__name__
        write_run_report(
            ok=False,
            running=False,
            step=step,
            phase="error",
            error=f"{type(exc).__name__}: {exc}",
            trace=trace,
            extra=extra,
            force=True,
        )
        return 1
    finally:
        if pop is not None:
            try:
                pop.quit()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
