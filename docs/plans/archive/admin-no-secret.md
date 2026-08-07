# Web 管理画面を API Secret なしで使えるようにする

## 目的・背景

管理画面は API と同じサーバー(`server/`)に同居しており、`/admin` 配下は本番では Cloudflare Access(Google 認証)で保護される。にもかかわらず管理画面の JS は iOS アプリと同じ `/api/*`(`X-API-Secret` 必須)を呼んでいるため、ブラウザで secret の入力・localStorage 保存が必要になっている。二重認証をやめ、管理画面はエッジの Access だけで使えるようにする。

esl-learning-assistant と同じ整理: `/api/*` = アプリ向け(`X-API-Secret`)、`/admin` = 人間向け(Cloudflare Access、アプリ層は無認証)。

## 対応方針

1. **`server/src/index.ts`**
   - API ルート(ping / generate / tasks / tracks / credits)をサブルーター `api` に切り出す
   - `/api` に従来どおり `X-API-Secret` ミドルウェア付きでマウント(iOS 向け、変更なし)
   - 同じサブルーターを `/admin/api` に**無認証で**マウント(管理画面向け。本番はエッジの Cloudflare Access が保護)
2. **`server/public/app.js`**
   - fetch 先を `/api/*` → `/admin/api/*` に変更
   - `X-API-Secret` 付与・localStorage 保存・401 時の prompt を削除
3. **ドキュメント追従**: `CLAUDE.md` の「API 認証」「バックエンド構成」を更新

## 影響範囲・セキュリティ

- iOS アプリ(`/api/*`)は変更なし
- ローカル(LAN)では `/admin/api/*` が無認証になる(従来は管理画面も secret が必要だった)。生成 = クレジット消費もローカル LAN から可能になるが、ローカル運用の割り切りとして許容(ユーザー判断)
- 本番は現行の Cloudflare Access 構成(root アプリ = Google Allow が `/admin` を包含、`/api` `/audio` `/images` は Bypass)のままで `/admin/api/*` も Google 認証下に入る。**Access の構成変更時も `/admin` が必ず Allow 側に残ること**(g3plus-ops 側の注意点)

## テスト方針

- `npm run typecheck`
- curl で確認:
  - `GET /admin/api/tasks` `GET /admin/api/tracks` → secret なしで 200
  - `POST /admin/api/generate`(空 body)→ secret なしで 400(バリデーションまで到達)
  - `GET /api/tasks` → secret なしは 401、secret ありは 200(従来どおり)
  - `GET /admin/` `GET /admin/app.js` → 200(静的配信と共存)
- ブラウザで `/admin/` を開き、secret 入力なしで一覧・生成が動くことを確認
