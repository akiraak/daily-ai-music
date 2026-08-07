# サーバの接続先を https://music.chobi.me にするプラン

## 目的・背景

サーバーが https://music.chobi.me で公開稼働している(`/health` が 200 を返すことを確認済み)。
現状の iOS 実機ビルド(`run-ios-device.sh`)は Mac の LAN IP を自動検出してローカルサーバーに接続する構成のため、Mac でサーバーを起動していないとアプリが使えない。実機アプリの既定接続先を本番(https://music.chobi.me)に切り替える。

## 対応方針

- `run-ios-device.sh`: 既定の `BACKEND_BASE_URL` を `https://music.chobi.me` にする
  - ローカル開発用に `--local` オプションを追加(従来どおり Mac の LAN IP を自動検出)
  - `BACKEND_BASE_URL` 環境変数での上書きは従来どおり可能
  - ビルド前に `/api/ping` へ疎通確認を行い、401(secret 不一致)や接続不可なら警告を出す(ビルドは継続。アプリの設定画面で上書き可能なため)
- コメント・ドキュメントの追随: `ios/project.yml`・`AppSettingsKeys.swift` のコメント、`CLAUDE.md`
- 変更しないもの:
  - シミュレータのフォールバック(`http://localhost:3014`)— 開発・UI テスト用に維持
  - Web 管理画面 — 相対パスで API を呼ぶため変更不要
  - `NSAllowsArbitraryLoads`(ローカル HTTP 接続用)— `--local` 運用が残るため維持

## 影響範囲

- `run-ios-device.sh`(接続先の既定値・オプション追加・疎通確認)
- `ios/project.yml` / `ios/DailyAIMusic/Sources/Support/AppSettingsKeys.swift`(コメントのみ)
- `CLAUDE.md` / `TODO.md` / `DONE.md`

## テスト方針

- `bash -n` で構文確認
- `https://music.chobi.me/health` と `/api/ping` への疎通確認(実測)
- 実機が接続されていれば `run-ios-device.sh` を実行してビルド・インストールを確認

## 既知の注意点

ローカル `.env` の `API_SECRET` は本番サーバーと**一致しない**(検証時 `/api/ping` が 401)。
ビルド時注入の secret では本番に認証できないため、以下のいずれかが必要:

- `.env` の `API_SECRET` を本番の値に更新する(ローカルサーバーも同じ値になる)
- アプリの設定画面で本番の API Secret を入力する(UserDefaults 優先のため以後有効)
