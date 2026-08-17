# メールストリーム (mail-stream-viewer2)

指定した送信元の英語メールを POP3 で取得し、ブラウザで日本語訳つきストリーム表示する PWA です。常時起動サーバーは使いません。GitHub Actions が取得し、GitHub Pages が画面を配信します。

## できること

- 指定送信元の新着だけを取り込む（サーバー上のメールは削除しない）
- スマホ・PC で同じ画面。リストとストリーム、既読 / 未読の同期
- 件名・本文を最初から日本語表示（原文トグルあり）
- 文字サイズ（ズーム）と、好きな位置に置ける PageDown ボタン

## リポジトリ構成

| パス | 役割 |
| --- | --- |
| `frontend/` | GitHub Pages に出す PWA。メール本文は含まない |
| `scripts/fetch_pop3.py` | POP3 取得と英日翻訳 |
| `.github/workflows/fetch-mail.yml` | 画面の「更新」から起動 |
| `.github/workflows/deploy-pages.yml` | フロントのデプロイ |
| `data/` | メールと設定（**private リポジトリ専用**） |

## セットアップ

### 1. GitHub リポジトリ

1. GitHub で **private** リポジトリを作る（メール本文が入るため）
2. このフォルダを push する

```bash
cd mail-stream-viewer2
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

無料プランでは private リポジトリの GitHub Pages が使えないことがあります。その場合は:

- このリポジトリは private のままデータ用にする
- `frontend/` だけを public リポジトリに置き、Pages はそちらで公開する
- アプリ設定の「データ用リポジトリ名」に private 側の名前を入れる

### 2. GitHub Secrets（POP3）

リポジトリの Settings → Secrets and variables → Actions に追加します。

| 名前 | 例 |
| --- | --- |
| `POP3_HOST` | `pop.example.com` |
| `POP3_PORT` | `995` |
| `POP3_USER` | 受信メールアドレス |
| `POP3_PASSWORD` | POP3 パスワード |
| `POP3_SSL` | `true` |

パスワードをコードや `data/` に書かないでください。

### 3. GitHub Pages

1. Settings → Pages → Build and deployment → Source を **GitHub Actions** にする
2. `Deploy Pages` ワークフローを手動実行するか、`frontend/` を push する
3. 表示された URL を控える

### 4. Personal Access Token

Fine-grained PAT を発行します。

- Resource owner: 自分
- Repository access: このリポジトリだけ
- Permissions:
  - **Contents**: Read and write
  - **Actions**: Read and write
- 有効期限は長めでも、漏洩したらすぐ取り消す

PAT は各端末のブラウザにだけ保存されます。git には入れません。

### 5. アプリの初回設定

1. Pages の URL を開く
2. 設定に owner / リポジトリ名 / ブランチ（`main`）/ PAT を入れて「この端末に接続を保存」
3. 送信元フィルタ（From に含まれる文字。カンマ区切り可）を入れて「設定を GitHub に保存」
4. 「更新」を押す。Actions が終わるまで数十秒かかることがあります
5. スマホでは共有 → ホーム画面に追加 で PWA 化できます

送信元フィルタが空のときは、誤って全件ダウンロードしないよう取得しません。

## ローカル開発

```bash
cd frontend
npm install
npm run dev
```

POP3 を手元で試す場合:

```bash
cp .env.example .env
# .env を編集
python scripts/fetch_pop3.py
```

`.env` は git に入れないでください。翻訳は取得時に行い、失敗しても原文は保存します。Chrome / Edge では未訳分をブラウザ内蔵の Translator API で補います。

## 画面操作

- **リスト**: 1 通を選ぶ。選ぶと既読になります
- **ストリーム**: 新しい順に連続表示。既定は日本語
- **原文 / 日本語**: 表示の切り替え
- **ズーム**: 80–200%。GitHub 上の設定に同期します
- **PageDown ボタン**: ドラッグで位置を変更（その端末だけ記憶）。タップでストリームを 1 画面分進めます

## 注意

- メール本文は private リポジトリの `data/` にコミットされます
- public な GitHub Pages にはフロントの殻だけを出してください
- POP3 は `DELE` しません。他のメーラーからも同じメールを読めます
