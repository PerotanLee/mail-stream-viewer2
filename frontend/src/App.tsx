import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmailPicker } from "./components/EmailPicker";
import { EmailStream } from "./components/EmailStream";
import { PageDownButton } from "./components/PageDownButton";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  GitHubError,
  FetchRunError,
  describeFetchFailure,
  loadEmail,
  loadIndex,
  loadLastRun,
  loadSettings,
  saveIndex,
  savePop3Secrets,
  saveSettings,
  triggerFetch,
  waitForFetchRun,
} from "./github";
import { loadConnection, loadPageDownPos, saveConnection } from "./storage";
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
  const [settings, setSettings] = useState<AppSettings>(emptySettings);
  const [pop3Password, setPop3Password] = useState("");
  const [settingsSha, setSettingsSha] = useState("");
  const [emails, setEmails] = useState<EmailIndexItem[]>([]);
  const [indexSha, setIndexSha] = useState("");
  const [records, setRecords] = useState<Record<string, EmailRecord>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pageDownPos, setPageDownPos] = useState<PageDownPos | null>(loadPageDownPos());
  const lastUiSync = useRef("");
  const streamRef = useRef<HTMLElement | null>(null);

  const unread = useMemo(() => byOldest(emails.filter((item) => !item.is_read)), [emails]);

  const refreshData = useCallback(
    async (conn: Connection) => {
      const [{ settings: nextSettings, sha: sSha }, { index, sha: iSha }] = await Promise.all([
        loadSettings(conn),
        loadIndex(conn),
      ]);
      setSettings(nextSettings);
      setSettingsSha(sSha);
      lastUiSync.current = String(nextSettings.zoom);
      setEmails(index.emails);
      const unreadItems = byOldest(index.emails.filter((item) => !item.is_read));
      setSelectedId((current) => {
        if (current && unreadItems.some((item) => item.id === current)) return current;
        return unreadItems[0]?.id ?? null;
      });
      setIndexSha(iSha);
      return index.emails;
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
        const items = await refreshData(conn);
        if (!cancelled) {
          await loadBodies(conn, items);
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
    if (!connected || !settingsSha || !connection.token) return;
    const key = String(settings.zoom);
    if (!lastUiSync.current) {
      lastUiSync.current = key;
      return;
    }
    if (lastUiSync.current === key) return;
    const handle = window.setTimeout(() => {
      saveSettings(connection, settings, settingsSha)
        .then((sha) => {
          setSettingsSha(sha);
          lastUiSync.current = key;
        })
        .catch(() => {
          /* keep local zoom even if sync fails */
        });
    }, 800);
    return () => window.clearTimeout(handle);
  }, [connected, connection, settings, settingsSha]);

  async function persistRead(nextEmails: EmailIndexItem[]) {
    if (!connection.token) return;
    const nextSha = await saveIndex(connection, { emails: nextEmails }, indexSha);
    setIndexSha(nextSha);
  }

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
    const next = emails.map((item) => (item.id === id ? { ...item, is_read: isRead } : item));
    setEmails(next);
    if (isRead) {
      setRecords((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      if (selectedId === id) {
        const remaining = byOldest(next.filter((item) => !item.is_read));
        setSelectedId(remaining[0]?.id ?? null);
      }
    }
    try {
      await persistRead(next);
    } catch (err) {
      setError(explain(err));
    }
  }

  async function handleSaveConnection() {
    saveConnection(connection);
    setConnected(true);
    setBusy(true);
    setError("");
    try {
      const items = await refreshData(connection);
      await loadBodies(connection, items);
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
      const sha = await saveSettings(connection, settings, settingsSha);
      setSettingsSha(sha);
      await savePop3Secrets(connection, settings, pop3Password);
      setPop3Password("");
      setStatus("設定を保存しました");
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRefresh() {
    if (!connection.token) {
      setTab("settings");
      setError("先に GitHub 接続を保存してください");
      return;
    }
    if (!settings.senderFilter.trim()) {
      setTab("settings");
      setError("送信元フィルタを保存してから更新してください");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("メールサーバへの接続を開始しています…");
    const startedAt = Date.now();
    try {
      await triggerFetch(connection);
      await waitForFetchRun(connection, startedAt, setStatus);
      setStatus("ダウンロードしたメールの一覧を読み込み中…");
      const items = await refreshData(connection);
      await loadBodies(connection, items);
      const report = await loadLastRun(connection);
      const added = typeof report?.added === "number" ? report.added : null;
      const unreadCount = items.filter((item) => !item.is_read).length;
      setStatus(
        added === null
          ? `取り込み完了（未読 ${unreadCount}通）`
          : `取り込み完了（新規 ${added}通 / 未読 ${unreadCount}通）`,
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
        <EmailPicker emails={unread} selectedId={selectedId} onSelect={(id) => selectEmail(id, true)} />
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
            onClick={() => setTab((current) => (current === "settings" ? "stream" : "settings"))}
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
              emails={unread}
              records={records}
              selectedId={selectedId}
              onSelect={(id) => selectEmail(id, false)}
              onToggleRead={toggleRead}
            />
          </section>
        </main>
        <aside className="panel settings-panel notranslate" translate="no">
          <SettingsPanel
            connection={connection}
            settings={settings}
            pop3Password={pop3Password}
            busy={busy}
            onConnection={setConnection}
            onSettings={setSettings}
            onPop3Password={setPop3Password}
            onSaveConnection={handleSaveConnection}
            onSaveSettings={handleSaveSettings}
          />
        </aside>
      </div>

      <nav className="tabs notranslate" translate="no">
        <button type="button" className={tab === "stream" ? "active" : ""} onClick={() => setTab("stream")}>
          ストリーム
        </button>
        <button
          type="button"
          className={tab === "settings" ? "active" : ""}
          onClick={() => setTab("settings")}
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
    if (err.status === 401 || err.status === 403) {
      return "GitHub 認証に失敗しました。PAT に Contents・Actions・Secrets の読み書きがあるか確認してください。";
    }
    if (err.status === 404) {
      return "リポジトリまたはファイルが見つかりません。owner / repo / ブランチを確認してください。";
    }
    if (err.status === 409) {
      return "他の端末と同時に更新されました。もう一度開いてからやり直してください。";
    }
  }
  if (err instanceof Error) return err.message;
  return "不明なエラーが起きました";
}
