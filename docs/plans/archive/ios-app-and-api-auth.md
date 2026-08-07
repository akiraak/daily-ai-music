# iOS アプリ + API 認証の実装プラン

## 目的・背景

現状はブラウザの管理画面(`server/public/`)でしか操作できない。TODO の「iOS アプリ(楽曲の一覧・再生、生成リクエストの送信)と API 認証方式」を実装し、iPhone から楽曲の一覧・再生・生成リクエストができるようにする。

まずはシンプルな仕組みを入れる。API 認証は [esl-learning-assistant](../../../esl-learning-assistant/) で実績のある方式をそのまま踏襲する:

- サーバー: `.env` の `API_SECRET` を `/api/*` で `X-API-Secret` ヘッダ必須にする(timing-safe 比較、起動時 fail-fast)
- iOS: XcodeGen(`project.yml`)+ SwiftUI。ビルド時に Info.plist へ URL / secret を埋め込み、設定画面(UserDefaults)で上書き可能
- 実機実行: `run-ios-device.sh` で Mac の LAN IP 自動検出 + secret 注入 + `devicectl` でインストール・起動

## 対応方針

3 Phase に分け、各 Phase 単体で動作確認できる順序にする。

### Phase 1: API 認証(server)

esl-learning-assistant の `backend/src/index.ts` と同じ方式。

- `config.ts`: リポジトリ直下 `.env` から `API_SECRET` を読む。未設定・16 文字未満・`[A-Za-z0-9_-]` 以外を含む場合は起動時に fail-fast(公開運用時に無防備にならないため。ローカルでも必須)
- `index.ts`: `/api/*` に Hono ミドルウェアを追加。`X-API-Secret` ヘッダを sha256 + `timingSafeEqual` で照合し、不一致は 401
- `GET /health`(無認証)と `GET /api/ping`(接続テスト用 = secret 一致確認)を追加
- Web 管理画面(`public/app.js`): `fetchJson()` で localStorage の secret を `X-API-Secret` として送る。401 なら `prompt()` で入力を求めて localStorage に保存しリロード
- `/audio/*` `/images/*` は**当面無認証のまま**とする。`<audio>` タグ・AVPlayer ストリーミングからカスタムヘッダを付けにくく、現状はローカル LAN 運用のため。公開ホスティング時に見直す(TODO に将来課題として残す)
- `.env.example` を追加(`API_SECRET` の生成例: `openssl rand -hex 16` を記載)

### Phase 2: iOS アプリ最小版(`ios/`)

esl-learning-assistant の `ios/` 構成を踏襲。XcodeGen + SwiftUI、iOS 17.0+、Swift 6。

- `project.yml`: ターゲット `DailyAIMusic`、Bundle ID `com.akiraak.dailyaimusic`、`DEVELOPMENT_TEAM: N38G4DGA67`
  - ビルド設定 `BACKEND_BASE_URL` / `BACKEND_API_SECRET` を Info.plist(`BackendBaseURL` / `BackendAPISecret`)へ埋め込む(既定は空。run-ios-device.sh が注入)
  - `NSAppTransportSecurity: NSAllowsArbitraryLoads: true`(ローカル HTTP 接続のため。クラウド化時に見直す)
  - `UIBackgroundModes: [audio]`(画面ロック中も再生継続)
- 画面(タブ 2 つ + 設定):
  - **楽曲一覧**: `GET /api/tracks` の一覧(カバー画像・タイトル・長さ・日付)。タップで再生。ミニプレイヤー(再生/一時停止・シーク)
  - **生成**: prompt 入力 + インストゥルメンタルのトグル → `POST /api/generate`。進行中タスクを `GET /api/tasks` の定期ポーリングで表示
  - **設定**: サーバー URL / API Secret(UserDefaults。未設定時は Info.plist 埋め込み値にフォールバック)。`GET /api/ping` での接続テストボタン
- `Services/BackendAPI.swift`: esl と同じ構造(URL 組み立て、`X-API-Secret` 付与、401 → `unauthorized` エラー、os.Logger でログ)
- 再生: AVPlayer で `/audio/<file>` を直接ストリーミング(Phase 1 の方針により無認証で取得可能)。ダウンロード・オフライン再生は将来課題
- ユニットテストは最小限(URL 組み立て・レスポンスのデコードなど、esl の構成に合わせて必要になったら追加)

### Phase 3: 実機実行スクリプト

- `run-ios-device.sh`(リポジトリ直下): esl のものを流用・簡略化
  - `xcodegen generate` を実行してから build(project.yml が真実源)
  - Mac の LAN IP 自動検出 → `BACKEND_BASE_URL=http://<ip>:3014`
  - リポジトリ直下 `.env` の `API_SECRET` を `BACKEND_API_SECRET` として注入
  - `xcodebuild` → `devicectl` でインストール・起動。`DEVICE_ID` / `BACKEND_BASE_URL` / `BACKEND_API_SECRET` 環境変数で上書き可
  - esl の `--prod` 相当は公開ホスティングが決まるまで作らない

## 影響範囲

- `server/src/config.ts` / `server/src/index.ts`: `API_SECRET` 読み込みと認証ミドルウェア追加
- `server/public/app.js`: secret の localStorage 管理とヘッダ付与
- `.env`(gitignore 済み): `API_SECRET` 追加が必須になる(**追加しないとサーバーが起動しなくなる**)
- 新規: `ios/` 一式、`run-ios-device.sh`、`.env.example`
- 完了時に `CLAUDE.md` の「現状」「未確定事項」を更新(API 認証方式・iOS UI フレームワークが確定)

## テスト方針

- **Phase 1**: `npm run typecheck` + curl で確認(ヘッダ無し → 401、正しい secret → 200、`/health` は無認証で 200、`/audio/*` は無認証のまま)。Web 管理画面で secret 入力後に一覧・生成が動くこと
- **Phase 2**: シミュレータで楽曲一覧・再生・生成リクエスト・設定画面の動作確認(`xcodebuild -destination 'platform=iOS Simulator,...' build` が通ること)
- **Phase 3**: 実機にインストールし、LAN 経由で一覧・再生・生成ができること(ユーザー確認)
