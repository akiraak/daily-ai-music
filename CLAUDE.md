# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

daily-ai-music は、Suno を使って音楽を生成し、iPhone から操作・再生できるアプリ。

- **毎日の自動生成**: スケジュール実行で毎日新しい曲を自動生成する
- **手動リクエスト**: iPhone からプロンプトを指定してその都度生成することもできる
- 生成した楽曲は iPhone アプリで一覧・再生できる

## 構成(予定)

| コンポーネント | 技術 | 役割 |
|---|---|---|
| iOS アプリ | ネイティブ(Swift) | 楽曲の一覧・再生、生成リクエストの送信 |
| バックエンド | TypeScript / Node.js | Suno 連携、楽曲メタデータ・音源の管理、毎日の自動生成スケジューラ、iOS アプリ向け API |

## 現状

バックエンド + Web 管理画面(`server/`)と iOS アプリ最小版(`ios/`)が動く。ブラウザ・iPhone から生成リクエスト・進行状況の確認・楽曲の一覧と再生ができる。自動生成スケジューラは未実装。

### コマンド

```bash
./run-server.sh        # サーバー起動 → 管理画面 http://localhost:3014/admin/(PORT 環境変数で変更可)
                       # 初回の npm install と、ポートを掴んでいる既存プロセスの停止も行う
./run-ios-device.sh    # iOS アプリを実機にインストール・起動(既定は本番 https://music.chobi.me へ接続、
                       # --local でMacのLAN IP自動検出。.env の API_SECRET 注入)

# 個別に実行する場合
cd server
npm run dev        # --watch 付き起動(開発用)
npm run typecheck  # tsc --noEmit

cd ios
xcodegen generate  # project.yml から .xcodeproj を生成(gitignore 対象)
xcodebuild -project DailyAIMusic.xcodeproj -scheme DailyAIMusic \
  -destination 'platform=iOS Simulator,name=iPhone 17' build   # シミュレータビルド
# UI テスト(要: サーバー起動 + BACKEND_API_SECRET=<.env の API_SECRET> を引数に付与)
xcodebuild test -project DailyAIMusic.xcodeproj -scheme DailyAIMusic \
  -destination 'platform=iOS Simulator,name=iPhone 17' BACKEND_API_SECRET=...
```

- Node 24 の TS 直接実行(型ストリップ)を使うためビルドステップは無い。`erasableSyntaxOnly` な構文のみ使用可(enum・パラメータプロパティ不可)。import は `.ts` 拡張子付きで書く
- API キーはリポジトリ直下の `.env`(`SUNOAPI_ORG_KEY` / `SUNOAPI_BASE_URL` / `API_SECRET`)から読む。`.env.example` 参照

### API 認証

esl-learning-assistant と同方式。`/api/*` は `X-API-Secret` ヘッダ必須(`.env` の `API_SECRET`。16 文字以上 `[A-Za-z0-9_-]`、未設定はサーバーが起動時 fail-fast)。sha256 で固定長に揃えた timing-safe 比較。`/health` は無認証(唯一の無認証経路)、`/api/ping` が接続テスト用。音源・カバー画像も API と同じ二重マウントで認証付き配信 — iOS は `/api/audio/*` `/api/images/*`(secret 必須。AVPlayer は `AVURLAsset` のヘッダ注入、画像は `CoverImageView` の自前ローダー)、管理画面は `/admin/audio/*` `/admin/images/*`(`<audio>/<img>` タグは Cookie 自動送信なので Access の認証 Cookie が効く)。`/api/tracks` の `audioUrl`/`imageUrl` はマウント先に応じたプレフィックス付きで返る。Web 管理画面は secret 不要 — 同居サーバーの `/admin/api/*`(同じ API ルートをアプリ層無認証でマウント。本番はエッジの Cloudflare Access が `/admin` ごと保護)を使う。iOS アプリはビルド時注入(Info.plist)+ 設定画面で上書き。

### バックエンド構成(`server/`)

- **Hono + @hono/node-server**: API・静的配信(`public/` の管理画面は `/admin` 配下。本番で Cloudflare Access をこのパスだけに掛けるため。`/` は `/admin/` へリダイレクト。音源・画像は `/api/audio/*` 等 + `/admin/audio/*` 等の二重マウントで Range 対応配信 — 上記「API 認証」参照)
- **node:sqlite**(`data/db.sqlite`): `tasks`(生成ジョブ)と `tracks`(完成楽曲)。`data/` は gitignore
- **`src/suno/client.ts`**: Suno 連携の抽象化インターフェース。実装は `kieai.ts`(kie.ai / sunoapi.org 互換)。公式 API が出たらここを差し替える
- **`src/generation.ts`**: 生成ジョブ管理。10 秒間隔のポーラーが未完了タスクを照会し、完了したら音源・カバー画像を即 `data/` へダウンロード(プロバイダの URL は一時ファイルのため)。サーバー再起動時も DB から未完了タスクを拾って自動再開
- **`src/llm.ts`**: Claude API(既定 `claude-sonnet-5`、`.env` の `LLM_MODEL` で変更可)。生成リクエストからスタイル・英語歌詞・日本語訳・タイトル・狙いを構造化出力で生成し、Suno へ `customMode: true` で送信する。評価(👍/👎/★)を好みプロファイル文書(`profile` テーブル、版を積む)へ反映する関数も持つ。`.env` に `ANTHROPIC_API_KEY` 必須(起動時 fail-fast)
- API: `POST /api/generate`(プリセット選択+自由テキスト → LLM 経由で生成)/ `GET /api/tasks` / `GET /api/tracks` / `POST /api/tracks/:id/rating` / `GET|POST|PUT|DELETE /api/presets` / `GET /api/profile` / `GET /api/credits` / `GET /api/ping`(同じルートを `/admin/api/*` にも無認証でマウント — 管理画面用)

### iOS アプリ構成(`ios/`)

- **XcodeGen + SwiftUI**(iOS 17+、Swift 6)。`project.yml` が真実源で `.xcodeproj` は生成物(gitignore)。esl-learning-assistant と同じ構成
- 画面: 楽曲一覧(AVPlayer ストリーミング再生・ミニプレイヤー・バックグラウンド再生対応)/ 生成(プロンプト送信 + 5 秒ポーリングの進行表示)/ 設定(サーバー URL・API Secret・接続テスト)
- `Services/BackendAPI.swift`: `/api/*` 共通処理(UserDefaults → Info.plist 埋め込み値の順で URL/secret を解決、`X-API-Secret` 付与、os.Logger)
- 接続先の既定はビルド時に Info.plist へ埋め込む(`run-ios-device.sh` が本番 `https://music.chobi.me` を注入。`--local` で Mac の LAN IP。空ならシミュレータ向けに `http://localhost:3014` へフォールバック)
- UI テスト(`DailyAIMusicUITests`): 一覧 → タップ → 再生開始のスモークテスト

## 未確定事項(決まり次第このファイルを更新)

- ~~Suno との連携方式~~ — 調査・検証済み([docs/specs/suno-api.md](docs/specs/suno-api.md))。当面はサードパーティ API を抽象化レイヤ越しに使い、公式 API(早期アクセス応募中)が出たら差し替える方針。**kie.ai**(sunoapi.org と同一運営・同一 API 構造、Bearer 認証)で生成フローを検証済み(sunoapi.org は Google ログイン不可だったため kie.ai を採用)。検証スクリプト: `scripts/verify-sunoapi.mjs`
- ~~バックエンドのフレームワーク~~ — Hono(Node.js 24)に決定。ホスティング先は未定(ランタイム可搬性の高い Hono を選んだのはこのため)
- 音源ファイルの保存先 — 当面はローカル `data/`。オブジェクトストレージ(S3 等)への移行は未定
- ~~iOS アプリの UI フレームワーク(SwiftUI を想定)と API 認証方式~~ — SwiftUI(XcodeGen、iOS 17+)と `X-API-Secret` ヘッダ認証に決定(上記「API 認証」参照)

<!-- vibeboard:begin -->
## 開発管理画面 (vibeboard)

ローカル開発時のタスク・プラン管理は [vibeboard](https://github.com/akiraak/vibeboard) で行う。
プロジェクト直下に degit で vendor してある（`./vibeboard/`）。

```bash
# 親プロジェクト直下から
node vibeboard/dist/cli.js --root .
```

`http://localhost:3010` でプロジェクト直下の `docs/plans/`・`docs/specs/`・`TODO.md`・`DONE.md`・`CLAUDE.md`・`README.md` を閲覧・編集できる。

- `Root` タブで `TODO.md` / `DONE.md` / `CLAUDE.md` / `README.md` をプレビュー表示・編集できる
  - 編集は楽観ロック（mtime チェック）付き。外部で先に更新されていた場合は保存時に 409 を返し、リロード / 手元維持 / 強制上書き を選べる
  - `fs.watch` + 2 秒ポーリングで外部変更を検知し、SSE でクライアントへ即時反映する
- ローカル開発専用（本番管理画面とは独立）
- ポート変更は `--port` または `VIBEBOARD_PORT` 環境変数で指定可能

## タスク管理ルール

- タスクは `TODO.md` で管理する
- タスクが完了したら `TODO.md` から該当項目を削除し、`DONE.md` に移動する
- `DONE.md` には完了日を `YYYY-MM-DD` 形式で付けて記録する
- 新しいタスクが発生したら `TODO.md` の適切なセクションに追加する
- タスクの実施前に `TODO.md` を確認し、優先度の高いものから着手する
- コミット時に `TODO.md` を確認し、実装した機能に対応するタスクがあれば `DONE.md` に移動する

## 作業着手ルール

作業（実装・調査いずれも）を始めるときは、コードに手を入れる前に以下を行う。

1. **プランファイルを作成する**: `docs/plans/<task-name>.md` に実装プラン or 調査プランを作成する
   - 目的・背景、対応方針、影響範囲、テスト方針を最低限記載する
   - 複数 Phase / Step に分かれる場合はファイル内でも Phase / Step を明示する
2. **`TODO.md` に該当項目があるか確認する**
   - 無ければ適切なセクションに追加する
   - 既存項目があれば、その項目に作成したプランファイルへのリンクを追記する（例: `[plan](docs/plans/<task-name>.md)`）
3. **複数 Phase / Step がある場合は `TODO.md` に子タスクとして追加する**
   - 親項目の下にインデントしたチェックボックスで Phase / Step を列挙する
   - Phase / Step が完了するごとにチェックを入れ、全完了で親項目を `DONE.md` に移す
4. **作業完了時の後片付け**
   - 親タスクを `DONE.md` に移動する
   - 対応するプランファイルは `docs/plans/archive/` に移動する
<!-- vibeboard:end -->

### このプロジェクト固有の vibeboard 設定

ポート 3010〜3012 は別プロジェクトが使用しているため、`vibeboard.config.json` でポートを **3013** に固定している。管理画面は `http://localhost:3013` で開く。起動は `./run-vibeboard.sh`(既存プロセスがポートを掴んでいれば停止してから起動する)。
