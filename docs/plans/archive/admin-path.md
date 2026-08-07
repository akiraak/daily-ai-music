# Web 管理画面を `/admin` 配下へ移動する

## 目的・背景

本番(https://music.chobi.me/ = g3plus)で Cloudflare Access(Google 認証)を管理画面だけに掛けたい。現状は管理画面が `/` 配信のため、Access をドメイン全体に掛けると `X-API-Secret` しか送らない iOS アプリ(`/api/*` `/audio/*` `/images/*`)が壊れる。管理画面を `/admin` 配下へ移し、Access を `music.chobi.me/admin` の 1 アプリに限定できるようにする。

Cloudflare Access 側の設定変更・デプロイは g3plus(g3plus-ops リポジトリ)側の作業で、本リポジトリでは扱わない。

## 対応方針

1. **`server/src/index.ts`**
   - `app.use("/*", serveStatic({ root: PUBLIC_DIR }))` を `/admin/*` マウントに変更(`rewriteRequestPath` で `/admin` プレフィックスを剥がす。`/audio` `/images` と同型)
   - `/admin`(末尾スラッシュ無し)は `/admin/` へリダイレクト(相対パス解決を安定させるため)
   - `/` は `/admin/` へリダイレクト(404 ではなくリダイレクトを採用。ブラウザ利用者の利便性のため)
   - 起動ログの URL を `/admin` 付きに更新
2. **`server/public/index.html`**
   - アセット参照 `/style.css` `/app.js` を `/admin/` 配下の絶対パスに変更
   - `app.js` 内の fetch 先(`/api/*`)と API が返す `/audio/*` `/images/*` はルート直下のまま変更不要
3. **ドキュメント追従**: `CLAUDE.md` の管理画面 URL 記述を更新

## 影響範囲

- `server/src/index.ts` / `server/public/index.html` / `CLAUDE.md`
- iOS アプリは `/api/*` `/audio/*` `/images/*` のみ利用のため影響なし
- 管理画面の localStorage(API Secret)は origin 単位なのでパス変更の影響なし

## テスト方針

- `npm run typecheck`
- サーバーを起動し curl で確認:
  - `GET /` → 302 → `/admin/`
  - `GET /admin` → 302 → `/admin/`
  - `GET /admin/` → 200(index.html)
  - `GET /admin/style.css` `GET /admin/app.js` → 200
  - `GET /health` → 200、`GET /api/ping`(secret 付き)→ 200、`GET /audio/*` が従来どおり配信されること
- ブラウザで `/admin/` を開き、一覧表示・生成フォームが動くことを目視確認(可能なら)
