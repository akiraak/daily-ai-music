# `/audio/*` `/images/*` を認証付き配信にする

## 目的・背景

音源・カバー画像の配信が唯一の無認証経路(推測不能 URL 保護のみ)として残っている(2026-08-06 の本番公開時からの割り切り。TODO.md 将来課題)。API と同じ二重マウントパターンに載せて認証を締め、「secret も Cloudflare Access も掛かっていない経路」を `/health` だけにする。

両クライアントとも認証情報を付けられることが判明しているため成立する:

- 管理画面: `<audio src>` `<img src>` は Cookie を自動送信する → Access の認証 Cookie で守られる `/admin/` 配下に置けばタグ直書きのまま動く
- iOS: AVPlayer は `AVURLAsset` の `AVURLAssetHTTPHeaderFieldsKey` オプションで `X-API-Secret` ヘッダを注入できる(公式ドキュメント外だが広く使われており、本アプリは App Store 審査を通らない個人アプリなので採用可)

## 対応方針

### Step 1: サーバー(`server/src/index.ts`)

- 音源・画像の serveStatic を `/api/audio/*` `/api/images/*`(既存の `/api/*` X-API-Secret ミドルウェアの配下)と `/admin/audio/*` `/admin/images/*`(アプリ層無認証・本番はエッジの Cloudflare Access)の 4 マウントに変更し、無認証の `/audio/*` `/images/*` は廃止
- `/api/tracks` が返す `audioUrl` / `imageUrl` を、リクエストのマウント先に応じたプレフィックス付きに変更(`/api/tracks` → `/api/audio/...`、`/admin/api/tracks` → `/admin/audio/...`)。これにより管理画面(`app.js` は API の返す URL をそのまま `src` に使う)は無変更で済む

### Step 2: iOS(`ios/DailyAIMusic/`)

- `BackendAPI` に、URLRequest を使えないメディア取得用のヘッダ辞書(`X-API-Secret`)と、ヘッダ付き GET でデータを取る `getData(path:)` を追加
- `PlayerService.play`: `AVPlayerItem(url:)` → `AVURLAsset(url:, options: [AVURLAssetHTTPHeaderFieldsKey: ...])` 経由に変更(Range・バックグラウンド再生は従来どおり)
- カバー画像: `AsyncImage`(ヘッダ不可)をやめ、`BackendAPI.getData` + メモリキャッシュ(NSCache)の小さな自前ビュー `CoverImageView` に置き換え

### Step 3: ドキュメント追従

- `CLAUDE.md`: API 認証セクションの「`/audio/*` `/images/*` は当面無認証」を認証必須の記述へ更新
- TODO.md 将来課題の該当項目を削除(本タスクで解消)
- 本番デプロイと g3plus-ops 側ドキュメント(workflow doc・CLAUDE.md の無認証記述)の追従は g3plus-ops 側タスクとして積む

## 影響範囲

- `server/src/index.ts` / `ios/DailyAIMusic/Sources/`(BackendAPI・PlayerService・TrackListView + 新規 CoverImageView)/ `CLAUDE.md` / `TODO.md`
- `server/public/app.js` は無変更(API が返す URL の形が変わるだけ)
- **API 互換性**: `audioUrl` の形が変わるため、旧アプリ(`/audio/...` を素で叩く)は新サーバーで再生不可になる。利用者は本人のみで iOS 側も同時更新するため許容
- DB・生成フロー(`generation.ts` はファイル名のみ保存)は不変

## テスト方針

- `npm run typecheck`
- ローカルでサーバーを起動し curl で確認:
  - `GET /audio/<file>` `GET /images/<file>` → 404(経路廃止)
  - `GET /api/audio/<file>` secret 無し → 401、secret 付き → 200、Range 付き → 206
  - `GET /admin/audio/<file>` `GET /admin/images/<file>` → 200
  - `GET /api/tracks` の audioUrl が `/api/audio/...`、`GET /admin/api/tracks` が `/admin/audio/...` になること
- iOS: シミュレータビルド + UI テスト(一覧 → タップ → 再生開始。要サーバー起動 + BACKend_API_SECRET 注入)で、認証付き経路でのカバー画像表示・AVPlayer 再生を確認
