import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmailPicker } from "./components/EmailPicker";
import { EmailStream } from "./components/EmailStream";
import { PageDownButton } from "./components/PageDownButton";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  GitHubError,
  FetchRunError,
  describeFetchFailure,
  isRateLimitError,
  loadEmail,
  loadIndex,
  loadLastRun,
  loadSettings,
  saveIndexMarkRead,
  savePop3Secrets,
  saveSettings,
  saveZoom,
  triggerFetch,
  waitForFetchRun,
} from "./github";
import { loadCachedSettings, loadConnection, loadPageDownPos, saveCachedSettings, saveConnection } from "./storage";
import type { AppSettings, Connection, EmailIndexItem, EmailRecord, PageDownPos } from "./types";
import "./App.css";

type Tab = "stream" | "settings";

function mailTime(item: EmailIndexItem): number {
  const value = Date.parse(item.date || "");
  return Number.isNaN(value) ? 0 : value;
}

function byOldest(items: EmailIndexItem[]): EmailIndexItem[] {
  return [...items].sort((a, b) => mailTime(a) - mailTime(b) || a.id.localeCompare(b.id));
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function isWithinWeek(item: EmailIndexItem): boolean {
  const value = mailTime(item);
  return value > 0 && Date.now() - value <= WEEK_MS;
}

function senderParts(filter: string): string[] {
  return filter
    .split(/[,、，;；]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function senderMatches(fromAddr: string, filter: string): boolean {
  const parts = senderParts(filter);
  if (!parts.length) return false;
  const haystack = (fromAddr || "").toLowerCase();
  return parts.some((part) => haystack.includes(part));
}

function visibleItems(items: EmailIndexItem[], senderFilter: string): EmailIndexItem[] {
  return byOldest(
    items.filter((item) => !item.is_read && isWithinWeek(item) && senderMatches(item.from_addr, senderFilter)),
  );
}

function keepFilled(next: string, prev: string): string {
  return next.trim() ? next : prev;
}

function mergeLocalSettings(prev: AppSettings, incoming: AppSettings): AppSettings {
  return {
    senderFilter: incoming.senderFilter.trim() || prev.senderFilter,
    zoom: incoming.zoom || prev.zoom,
    displayLang: incoming.displayLang === "en" ? "en" : "ja",
    pop3Host: incoming.pop3Host.trim() || prev.pop3Host,
    pop3Port: incoming.pop3Port.trim() || prev.pop3Port,
    pop3User: incoming.pop3User.trim() || prev.pop3User,
    pop3Ssl: incoming.pop3Ssl,
  };
}

const emptyConnection: Connection = {
  owner: "PerotanLee",
  repo: "mail-stream-viewer2",
  token: "",
  branch: "main",
};
const emptySettings: AppSettings = {
  senderFilter: "",
  zoom: 100,
  displayLang: "ja",
  pop3Host: "",
  pop3Port: "995",
  pop3User: "",
  pop3Ssl: true,
};

export default function App() {
  const [tab, setTab] = useState<Tab>("stream");
  const [connection, setConnection] = useState<Connection>(loadConnection() ?? emptyConnection);
  const [connected, setConnected] = useState(true);
  const [settings, setSettings] = useState<AppSettings>(loadCachedSettings() ?? emptySettings);
  const [pop3Password, setPop3Password] = useState("");
  const [emails, setEmails] = useState<EmailIndexItem[]>([]);
  const [records, setRecords] = useState<Record<string, EmailRecord>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pageDownPos, setPageDownPos] = useState<PageDownPos | null>(loadPageDownPos());
  const lastUiSync = useRef("");
  const streamRef = useRef<HTMLElement | null>(null);
  const connectionRef = useRef(connection);
  const pendingReadIds = useRef(new Set<string>());
  const readFlush = useRef(Promise.resolve());
  const readTimer = useRef(0);
  connectionRef.current = connection;

  const visible = useMemo(
    () => visibleItems(emails, settings.senderFilter),
    [emails, settings.senderFilter],
  );

  const refreshData = useCallback(
    async (conn: Connection) => {
      const [{ settings: nextSettings }, { index }] = await Promise.all([
        loadSettings(conn),
        loadIndex(conn),
      ]);
      setSettings(nextSettings);
      saveCachedSettings(nextSettings);
      lastUiSync.current = String(nextSettings.zoom);
      setEmails(index.emails);
      const shown = visibleItems(index.emails, nextSettings.senderFilter);
      setSelectedId((current) => {
        if (current && shown.some((item) => item.id === current)) return current;
        return shown[0]?.id ?? null;
      });
      return { items: index.emails, senderFilter: nextSettings.senderFilter };
    },
    [],
  );

  const loadBodies = useCallback(async (conn: Connection, items: EmailIndexItem[]) => {
    const ordered = byOldest(items.filter((item) => !item.is_read));
    let loaded = 0;
    setStatus(ordered.length ? `未読の本文を読み込み中 0/${ordered.length}` : "");
    for (let i = 0; i < ordered.length; i += 5) {
      const batch = ordered.slice(i, i + 5);
      const fetched: Record<string, EmailRecord> = {};
      await Promise.all(
        batch.map(async (item) => {
          try {
            fetched[item.id] = await loadEmail(conn, item.file);
          } catch {
            // keep list usable even if one body file is missing
          }
        }),
      );
      loaded += batch.length;
      setRecords((prev) => ({ ...prev, ...fetched }));
      setStatus(`未読の本文を読み込み中 ${Math.min(loaded, ordered.length)}/${ordered.length}`);
    }
  }, []);

  useEffect(() => {
    const conn = loadConnection() ?? emptyConnection;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError("");
      setStatus("保存済みのメールを読み込み中…");
      try {
        const { items, senderFilter } = await refreshData(conn);
        if (!cancelled) {
          await loadBodies(conn, visibleItems(items, senderFilter));
          if (!cancelled) setStatus("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(explain(err));
          setTab("settings");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadBodies, refreshData]);

  useEffect(() => {
    if (!connected || !connection.token) return;
    const zoom = settings.zoom;
    if (!lastUiSync.current) {
      lastUiSync.current = String(zoom);
      return;
    }
    if (lastUiSync.current === String(zoom)) return;
    const handle = window.setTimeout(() => {
      saveZoom(connection, zoom)
        .then((result) => {
          setSettings((current) => {
            const next = { ...result.settings, zoom: current.zoom };
            saveCachedSettings(next);
            return next;
          });
          lastUiSync.current = String(zoom);
        })
        .catch(() => {
          /* keep local zoom even if sync fails */
        });
    }, 800);
    return () => window.clearTimeout(handle);
  }, [connected, connection, settings.zoom]);

  async function flushPendingReads() {
    const conn = connectionRef.current;
    if (!conn.token) return;
    let rounds = 0;
    while (pendingReadIds.current.size) {
      if (rounds++ > 8) {
        pendingReadIds.current.clear();
        return;
      }
      const ids = [...pendingReadIds.current];
      pendingReadIds.current.clear();
      try {
        const result = await saveIndexMarkRead(conn, ids);
        setEmails(result.index.emails);
      } catch (err) {
        for (const id of ids) pendingReadIds.current.add(id);
        if (
          isRateLimitError(err) ||
          (err instanceof GitHubError && (err.status === 409 || err.status === 422))
        ) {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
          continue;
        }
        pendingReadIds.current.clear();
        return;
      }
    }
  }

  function queueReadFlush() {
    window.clearTimeout(readTimer.current);
    readTimer.current = window.setTimeout(() => {
      const job = readFlush.current.then(flushPendingReads);
      readFlush.current = job.catch(() => {});
    }, 800);
  }

  useEffect(() => {
    const flushNow = () => {
      window.clearTimeout(readTimer.current);
      if (!pendingReadIds.current.size) return;
      const job = readFlush.current.then(flushPendingReads);
      readFlush.current = job.catch(() => {});
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushNow);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushNow);
    };
  }, []);

  async function selectEmail(id: string, scroll = false) {
    setSelectedId(id);
    setTab("stream");
    const current = emails.find((item) => item.id === id);
    if (current && !current.is_read && !records[id]) {
      try {
        const record = await loadEmail(connection, current.file);
        setRecords((prev) => ({ ...prev, [id]: record }));
      } catch (err) {
        setError(explain(err));
      }
    }
    if (!scroll) return;
    const stream = streamRef.current;
    const card = document.getElementById(`mail-${id}`);
    if (!stream || !card) return;
    const top = card.getBoundingClientRect().top - stream.getBoundingClientRect().top + stream.scrollTop - 8;
    stream.scrollTo({ top: Math.max(0, top) });
  }

  async function toggleRead(id: string, isRead: boolean) {
    if (!isRead) return;
    pendingReadIds.current.add(id);
    const next = emails.map((item) => (item.id === id ? { ...item, is_read: true } : item));
    setEmails((prev) => prev.map((item) => (item.id === id ? { ...item, is_read: true } : item)));
    setRecords((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    if (selectedId === id) {
      const remaining = visibleItems(next, settings.senderFilter);
      setSelectedId(remaining[0]?.id ?? null);
    }
    setError("");
    queueReadFlush();
  }

  function applySettings(next: AppSettings) {
    setSettings((prev) => mergeLocalSettings(prev, next));
  }

  function applyConnection(next: Connection) {
    setConnection((prev) => ({
      ...next,
      owner: keepFilled(next.owner, prev.owner),
      repo: keepFilled(next.repo, prev.repo),
      token: keepFilled(next.token, prev.token),
      branch: keepFilled(next.branch, prev.branch) || "main",
    }));
  }

  async function openSettings() {
    setTab("settings");
    const conn = loadConnection() ?? connection;
    if (!conn.token) return;
    try {
      const loaded = await loadSettings(conn);
      setSettings((prev) => {
        const next = mergeLocalSettings(prev, loaded.settings);
        saveCachedSettings(next);
        return next;
      });
    } catch {
      /* keep cached values on screen */
    }
  }

  async function handleSaveConnection() {
    const conn = {
      ...connection,
      token: connection.token || loadConnection()?.token || "",
    };
    setConnection(conn);
    saveConnection(conn);
    setConnected(true);
    setBusy(true);
    setError("");
    try {
      const { items, senderFilter } = await refreshData(conn);
      await loadBodies(conn, visibleItems(items, senderFilter));
      setStatus("");
      setTab("stream");
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSettings() {
    setBusy(true);
    setError("");
    try {
      const result = await saveSettings(connection, settings);
      setSettings(result.settings);
      saveCachedSettings(result.settings);
      lastUiSync.current = String(result.settings.zoom);
      await savePop3Secrets(connectionRef.current, result.settings, pop3Password);
      setPop3Password("");
      await loadBodies(connection, visibleItems(emails, result.settings.senderFilter));
      setStatus("設定を保存しました");
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRefresh() {
    const conn = loadConnection() ?? connection;
    if (conn.token) setConnection(conn);
    if (!conn.token) {
      setTab("settings");
      setError("先に GitHub 接続を保存してください");
      return;
    }
    let filter = settings.senderFilter.trim();
    try {
      const loaded = await loadSettings(conn);
      const next = mergeLocalSettings(settings, loaded.settings);
      setSettings(next);
      saveCachedSettings(next);
      filter = next.senderFilter.trim();
    } catch {
      /* use values already on this device */
    }
    if (!filter) {
      setTab("settings");
      setError("送信元フィルタを保存してから更新してください");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("更新を開始しています…");
    const startedAt = Date.now();
    try {
      await triggerFetch(conn);
      await waitForFetchRun(conn, startedAt, setStatus);
      setStatus("ダウンロードしたメールの一覧を読み込み中…");
      const { items, senderFilter } = await refreshData(conn);
      const shown = visibleItems(items, senderFilter);
      await loadBodies(conn, shown);
      const report = await loadLastRun(connection);
      const added = typeof report?.added === "number" ? report.added : null;
      setStatus(
        added === null
          ? `取り込み完了（直近1週間の未読 ${shown.length}通）`
          : `取り込み完了（新規 ${added}通 / 直近1週間の未読 ${shown.length}通）`,
      );
      setTab("stream");
      window.setTimeout(() => {
        setStatus((current) => (current.startsWith("取り込み完了") ? "" : current));
      }, 8000);
    } catch (err) {
      let detail = explain(err);
      if (err instanceof FetchRunError) {
        try {
          detail = await describeFetchFailure(connection, err.run);
        } catch (inner) {
          detail = `${explain(err)}\n${explain(inner)}`;
        }
      }
      setError(detail);
      console.error(detail, err);
    } finally {
      setBusy(false);
    }
  }

  const workspaceClass = `workspace show-${tab}`;

  return (
    <div className="shell">
      <header className="topbar notranslate" translate="no">
        <div className="brand">メールストリーム</div>
        <EmailPicker emails={visible} selectedId={selectedId} onSelect={(id) => selectEmail(id, true)} />
        <div className="topbar-actions">
          <div className="zoom-wrap">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setSettings((s) => ({ ...s, zoom: Math.max(80, s.zoom - 10) }))}
              aria-label="縮小"
            >
              −
            </button>
            <span className="meta">{settings.zoom}%</span>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setSettings((s) => ({ ...s, zoom: Math.min(200, s.zoom + 10) }))}
              aria-label="拡大"
            >
              ＋
            </button>
          </div>
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              if (tab === "settings") setTab("stream");
              else void openSettings();
            }}
          >
            設定
          </button>
          <button type="button" className="text-btn primary" onClick={handleRefresh} disabled={busy}>
            {busy ? "処理中" : "更新"}
          </button>
        </div>
        {busy || status ? <div className="status-bar">{status || "処理中…"}</div> : null}
      </header>

      <div className={workspaceClass}>
        <main
          className="panel stream-panel"
          style={{ ["--zoom" as string]: String(settings.zoom / 100) }}
        >
          <section ref={streamRef} className="stream">
            {error ? (
              <pre className="error notranslate" translate="no">
                {error}
              </pre>
            ) : null}
            <EmailStream
              emails={visible}
              records={records}
              selectedId={selectedId}
              onSelect={(id) => selectEmail(id, false)}
              onToggleRead={toggleRead}
            />
          </section>
        </main>
        <aside className="panel settings-panel notranslate" translate="no">
          {tab === "settings" ? (
          <SettingsPanel
            connection={connection}
            settings={settings}
            pop3Password={pop3Password}
            busy={busy}
            onConnection={applyConnection}
            onSettings={applySettings}
            onPop3Password={setPop3Password}
            onSaveConnection={handleSaveConnection}
            onSaveSettings={handleSaveSettings}
          />
          ) : null}
        </aside>
      </div>

      <nav className="tabs notranslate" translate="no">
        <button type="button" className={tab === "stream" ? "active" : ""} onClick={() => setTab("stream")}>
          ストリーム
        </button>
        <button
          type="button"
          className={tab === "settings" ? "active" : ""}
          onClick={() => void openSettings()}
        >
          設定
        </button>
      </nav>

      <PageDownButton streamRef={streamRef} pos={pageDownPos} onPos={setPageDownPos} />
    </div>
  );
}

function explain(err: unknown): string {
  if (err instanceof GitHubError) {
    if (isRateLimitError(err)) {
      return "GitHub への保存が短時間に多すぎます。1分ほど待ってから既読や更新をやり直してください。設定は消えていません。";
    }
    if (err.status === 401 || err.status === 403) {
      return "GitHub 認証に失敗しました。PAT に Contents・Actions・Secrets の読み書きがあるか確認してください。";
    }
    if (err.status === 404) {
      return "リポジトリまたはファイルが見つかりません。owner / repo / ブランチを確認してください。";
    }
    if (err.status === 409 || err.status === 422) {
      return "保存が他の更新と重なりました。少し待ってから更新してください。";
    }
  }
  if (err instanceof Error) return err.message;
  return "不明なエラーが起きました";
}
