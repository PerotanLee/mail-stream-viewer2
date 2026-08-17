import type { AppSettings, Connection } from "../types";

type Props = {
  connection: Connection;
  settings: AppSettings;
  pop3Password: string;
  busy: boolean;
  onConnection: (next: Connection) => void;
  onSettings: (next: AppSettings) => void;
  onPop3Password: (value: string) => void;
  onSaveConnection: () => void;
  onSaveSettings: () => void;
};

export function SettingsPanel({
  connection,
  settings,
  pop3Password,
  busy,
  onConnection,
  onSettings,
  onPop3Password,
  onSaveConnection,
  onSaveSettings,
}: Props) {
  return (
    <div className="settings">
      <h2>接続</h2>
      <p className="hint">
        GitHub PAT（Contents / Actions / Secrets の読み書き）は、更新・既読・POP3 保存に必要です。この端末にだけ保存します。
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

      <h2>POP3</h2>
      <p className="hint">
        ホスト・ユーザーは設定ファイルに保存します。パスワードは GitHub Secrets だけに暗号化して保存し、画面や git には残しません。
      </p>
      <label>
        ホスト
        <input
          value={settings.pop3Host}
          onChange={(e) => onSettings({ ...settings, pop3Host: e.target.value })}
          placeholder="pop.example.com"
        />
      </label>
      <label>
        ポート
        <input
          value={settings.pop3Port}
          onChange={(e) => onSettings({ ...settings, pop3Port: e.target.value })}
          placeholder="995"
        />
      </label>
      <label>
        ユーザー名（受信アドレス）
        <input
          value={settings.pop3User}
          onChange={(e) => onSettings({ ...settings, pop3User: e.target.value })}
          placeholder="you@example.com"
          autoComplete="username"
        />
      </label>
      <label>
        パスワード
        <input
          type="password"
          autoComplete="new-password"
          value={pop3Password}
          onChange={(e) => onPop3Password(e.target.value)}
          placeholder="変更するときだけ入力"
        />
        <span className="hint">空のまま保存すると、既存のパスワードは変えません。</span>
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.pop3Ssl}
          onChange={(e) => onSettings({ ...settings, pop3Ssl: e.target.checked })}
        />
        SSL を使う（通常はオン、ポート 995）
      </label>

      <h2>メール</h2>
      <label>
        送信元フィルタ
        <input
          value={settings.senderFilter}
          onChange={(e) => onSettings({ ...settings, senderFilter: e.target.value })}
          placeholder="alerts@example.com"
        />
        <span className="hint">
          From に含まれる文字列だけを、最初から対象にします。半角カンマ区切りで複数可（例: wsj, alerts@example.com）。空だと取得しません。直近1週間の未読のみ読み込みます。保存したあと「更新」が必要です。
        </span>
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
      <p className="hint">
        本文は英語のまま表示します。Chrome / Edge / Safari のページ翻訳を日本語にしてください。操作ボタンは翻訳しません。
      </p>
      <button type="button" className="text-btn primary" onClick={onSaveSettings} disabled={busy}>
        設定を GitHub に保存
      </button>
    </div>
  );
}
