# Logiris2（mail-stream-viewer2）

指定した送信元のメールを POP3 で取得し、ブラウザでストリーム表示する個人用 PWA です。常時起動サーバーは使いません。

- 取得: GitHub Actions（画面の「更新」から起動）
- 画面: GitHub Pages
- 本文データ: リポジトリの `data/`（GitHub Contents API で読み書き）

公開画面: https://perotanlee.github.io/mail-stream-viewer2/

## いまの動き

- サーバー上のメールは削除しません（POP3 の `DELE` は使いません）。
- 画面に出すのは **直近 1 週間・未読・送信元フィルタに一致** したものだけです。並びは **古い順** です。
- 「既読にする」とその通は消え、`data/index.json` に既読として保存します。未読に戻す操作はありません。
- 本文は英語のまま保存します。表示時にページ内の Google 翻訳で日本語にします。原文／日本語の切替ボタンはありません。
- 取得は自動ではありません。必要なら「更新」を押します。

## 構成

| パス | 役割 |
| --- | --- |
| `frontend/` | GitHub Pages に出す PWA（メール本文は含まない） |
| `scripts/fetch_pop3.py` | POP3 取得。ヘッダーで絞り、一致した通だけ本文を取る |
| `.github/workflows/fetch-mail.yml` | 「更新」から起動する取得ジョブ |
| `.github/workflows/deploy-pages.yml` | `frontend/` の変更で Pages をビルド |
| `data/` | 設定・一覧・本文 JSON。**メール本文が入るため private 推奨** |

接続の初期値は owner `PerotanLee` / repo `mail-stream-viewer2` / ブランチ `main` です。設定画面で変えられます。

## データの置き方

| ファイル | 内容 |
| --- | --- |
| `data/settings.json` | 送信元フィルタ、ズーム、POP3 ホスト／ポート／ユーザー／SSL |
| `data/index.json` | 通の一覧と既読フラグ |
| `data/emails/*.json` | 本文（HTML / テキスト）。UID のハッシュがファイル名 |
| `data/last-run.json` | 取得の進捗と結果（画面の途中表示に使う） |
| `data/fetch-cursor.json` | 前回取得の時刻と、そのときの POP3 最新番号 |

POP3 パスワードは `data/` にも git にも入れません。GitHub Actions Secrets（`POP3_PASSWORD` など）だけに保存します。

## 取得の仕方

1. 画面の「更新」が `fetch-mail.yml` を起動します。
2. 送信元フィルタが空なら、誤って全件取らないよう取得しません。
3. 新しいメールからヘッダーだけ見ます（`TOP`）。日付が前回取得より古い通が続くと打ち切ります。
4. From がフィルタに合う通だけ `UIDL` と本文（`RETR`）を取ります。メールボックス全体の UID 一覧は取りません。
5. すでに `index.json` にある UID は本文を取り直しません。
6. 終わると `fetch-cursor.json` に時刻と最新番号を書きます。次回は **その番号より新しい通だけ** を見ます。
7. 画面に残す期間は直近 1 週間です。それより古い通は index と本文ファイルから外します。

フィルタはカンマ類（`,、，;；`）区切りで、From に含まれる文字列なら一致です（例: `wsj,axios`）。

初回やカーソルが無いときは、直近の成功時刻（`last-run.json`）を起点にします。15 分の重なりを見て取りこぼしを減らします。

## 画面

- **ストリーム**: 未読の本文を続けて表示。HTML メールはレイアウトと画像を保ったまま出します。
- **題名ドロップダウン**: 表示中の未読から 1 通へジャンプします。選んでも既読にはしません。
- **既読にする**: その通を隠して GitHub に保存します。保存が他の更新と重なっても、最新の一覧を取り直してやり直します。失敗しても未読には戻しません。
- **文字の大きさ**: 80–200%。題名だけでなく本文 HTML の段組・画像にもかかります。接続中は GitHub の設定へ同期します。
- **PageDown**: ドラッグで位置を変え、タップでストリームを約 1 画面分進めます。位置はその端末だけ覚えます。
- **設定**: GitHub 接続（PAT）、POP3、送信元フィルタ。設定パネルを開いているときだけ入力欄を出します。

操作ボタン・設定・エラーは翻訳しません。件名・送信元・本文だけ日本語になります。

インストールした PWA（ホーム画面）ではブラウザの翻訳ボタンが出ないため、ページ内翻訳を使います。ネット接続が必要です。

## セットアップ

### 1. リポジトリ

メール本文が `data/` にコミットされるので、**データ用リポジトリは private** にしてください。無料プランで private の Pages が使えない場合は:

- データ用は private のまま
- `frontend/` だけ public リポジトリで Pages 公開
- アプリの「データ用リポジトリ名」に private 側を指定

### 2. GitHub Pages

1. Settings → Pages → Source を **GitHub Actions** にする
2. `Deploy Pages` を動かす（`frontend/` の push でも動きます）
3. 表示された URL を開く

### 3. Personal Access Token

Fine-grained PAT を、このリポジトリだけに発行します。

- **Contents**: Read and write
- **Actions**: Read and write
- **Secrets**: Read and write

PAT は各端末のブラウザ（localStorage）にだけ保存します。git には入れません。

### 4. 初回の画面操作

1. owner / データ用リポジトリ / ブランチ（`main`）/ PAT を入れて「この端末に接続を保存」
2. 送信元フィルタと POP3（パスワード含む）を入れて「設定を GitHub に保存」
3. 「更新」を押す
4. スマホでは共有 → ホーム画面に追加 で PWA にできます

パスワード欄を空のまま保存すると、既存の Secrets は変えません。

フロントを更新したあとは、ブラウザなら強制再読み込み、インストール済みならアプリを一度閉じて開き直してください。

## ローカル開発

```bash
cd frontend
npm install
npm run dev
```

POP3 を手元で試す場合:

```bash
cp .env.example .env
# .env を編集（git に入れない）
python scripts/fetch_pop3.py
```

手元実行でもサーバー上のメールは残します。画面のメール表示には、PAT 経由で GitHub 上の `data/` を読みます。

## 注意

- 「更新」以外では取得しません。スケジュール実行もありません。
- 取得ジョブの制限時間は 12 分です。画面は最大約 8 分待ちます。
- GitHub API に独自の `Cache-Control` ヘッダーは付けません（Pages からの CORS で失敗するため）。
- 広告ブロッカーなどで Google 翻訳スクリプトが止まると、本文は英語のままです。
- public リポジトリの `data/` は第三者から読めます。本文を置くなら private にしてください。
