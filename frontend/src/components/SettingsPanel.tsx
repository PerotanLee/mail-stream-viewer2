import type { AppSettings, Connection } from "../types";

type Props = {
  connection: Connection;
  settings: AppSettings;
  busy: boolean;
  onConnection: (next: Connection) => void;
  onSettings: (next: AppSettings) => void;
  onSaveConnection: () => void;
  onSaveSettings: () => void;
};

export function SettingsPanel({
  connection,
  settings,
  busy,
  onConnection,
  onSettings,
  onSaveConnection,
  onSaveSettings,
}: Props) {
  return (
    <div className="settings">
      <h2>接続</h2>
      <p className="hint">
        GitHub の PAT（Contents 読み書き、Actions 書き込み）は「更新」と既読保存に必要です。公開リポジトリなら閲覧だけは PAT なしでもできます。POP3 パスワードは GitHub Secrets に置いてください。
      </p>
      <label>
        owner
        <input
          value={connection.owner}
          onChange={(e) => onConnection({ ...connection, owner: e.target.value.trim() })}
          placeholder="your-github-name"
        />
      </label>
      <label>
        データ用リポジトリ名
        <input
          value={connection.repo}
          onChange={(e) => onConnection({ ...connection, repo: e.target.value.trim() })}
          placeholder="mail-stream-viewer2"
        />
      </label>
      <label>
        ブランチ
        <input
          value={connection.branch}
          onChange={(e) => onConnection({ ...connection, branch: e.target.value.trim() || "main" })}
        />
      </label>
      <label>
        GitHub PAT
        <input
          type="password"
          autoComplete="off"
          value={connection.token}
          onChange={(e) => onConnection({ ...connection, token: e.target.value.trim() })}
          placeholder="github_pat_..."
        />
      </label>
      <button type="button" className="text-btn primary" onClick={onSaveConnection} disabled={busy}>
        この端末に接続を保存
      </button>

      <h2>メール</h2>
      <label>
        送信元フィルタ
        <input
          value={settings.senderFilter}
          onChange={(e) => onSettings({ ...settings, senderFilter: e.target.value })}
          placeholder="alerts@example.com"
        />
        <span className="hint">From に含まれる文字列。カンマ区切りで複数可。空だと取得しません。</span>
      </label>
      <label>
        文字の大きさ {settings.zoom}%
        <input
          type="range"
          min={80}
          max={200}
          step={10}
          value={settings.zoom}
          onChange={(e) => onSettings({ ...settings, zoom: Number(e.target.value) })}
        />
      </label>
      <label>
        本文の既定表示
        <select
          value={settings.displayLang}
          onChange={(e) => onSettings({ ...settings, displayLang: e.target.value === "en" ? "en" : "ja" })}
        >
          <option value="ja">日本語訳</option>
          <option value="en">原文</option>
        </select>
      </label>
      <button type="button" className="text-btn primary" onClick={onSaveSettings} disabled={busy}>
        設定を GitHub に保存
      </button>
    </div>
  );
}
