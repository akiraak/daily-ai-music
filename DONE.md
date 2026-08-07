# DONE

- [x] 2026-08-06 Web 管理画面を `/` 配信から `/admin` 配下へ移動する(Cloudflare Access をパス限定で掛けるため)— サーバ側は `/admin/*` マウント + `/` `/admin` → `/admin/` リダイレクト(7ff057e)で対応しデプロイ済み。Cloudflare Access は `music.chobi.me` の Path `admin` 1 アプリ(Google IdP のみ)に整理され、暫定のパス分割(`/api` `/audio` `/images` Bypass + root Allow)は解消。本番外形確認(2026-08-06): `/admin/*`(`/admin/api/*` 含む)が Access ログインへ 302(ログインページは Google のみ・OTP 無し)、`/` は Access 素通りでアプリが `/admin/` へ 302、secret 付き `/api/ping` 200・無しは 401、`/audio/*` `/images/*` は従来どおり配信。プラン: [docs/plans/archive/admin-path.md](docs/plans/archive/admin-path.md)

- [x] 2026-08-06 Web 管理画面を API Secret なしで使えるようにする — API ルートをサブルーター化して `/api`(X-API-Secret 必須・iOS 向け)と `/admin/api`(アプリ層無認証・管理画面向け)の両方にマウントし、管理画面 JS から secret 付与・localStorage 保存・401 時の入力プロンプトを削除。本番はエッジの Cloudflare Access が `/admin` ごと保護する(ローカル LAN では `/admin/api/*` が無認証になる点は許容)。プラン: [docs/plans/archive/admin-no-secret.md](docs/plans/archive/admin-no-secret.md)

- [x] 2026-08-06 サーバの接続先を https://music.chobi.me — `run-ios-device.sh` の既定接続先を本番 `https://music.chobi.me` に変更(`--local` で従来の Mac LAN IP 接続、ビルド前に `/api/ping` 疎通確認を追加)。実機ビルド・インストール・起動を確認。**注意**: ローカル `.env` の `API_SECRET` は本番と不一致(401)のため、`.env` を本番の値に更新するかアプリの設定画面で本番 Secret の入力が必要。プラン: [docs/plans/archive/backend-endpoint-music-chobi-me.md](docs/plans/archive/backend-endpoint-music-chobi-me.md)

- [x] 2026-08-06 iOS アプリ(楽曲の一覧・再生、生成リクエストの送信)と API 認証方式 — `/api/*` を `X-API-Secret` ヘッダ認証に(esl-learning-assistant と同方式。timing-safe 比較・起動時 fail-fast・Web 管理画面は localStorage で対応)。`ios/` に XcodeGen + SwiftUI アプリ(楽曲一覧・AVPlayer 再生・生成リクエスト・設定画面)を作成し、UI テストで再生フローを検証、`run-ios-device.sh` で実機インストール・起動まで確認。プラン: [docs/plans/archive/ios-app-and-api-auth.md](docs/plans/archive/ios-app-and-api-auth.md)

- [x] 2026-08-06 音楽生成の仕組みを決める — 会話で設計を確定。LLM(Sonnet 5)が好みプロファイル+プリセットからスタイル・英語歌詞・日本語訳を生成し customMode で Suno へ。評価は 👍/👎+★、冒険日 20%、毎朝 6:00(PT)に 1 リクエスト(2 曲)。仕様: [docs/specs/music-generation.md](docs/specs/music-generation.md)

- [x] 2026-08-06 Web管理画面の作成と音楽の生成と再生 — `server/`(Hono + node:sqlite)に生成 API・ポーリングジョブ・管理画面を実装。E2E で実生成 1 回(2 曲保存・再生)を確認。起動: `cd server && npm start` → http://localhost:3014。プラン: [docs/plans/archive/web-admin-music-generation.md](docs/plans/archive/web-admin-music-generation.md)

- [x] 2026-08-06 Suno との連携方式(公式 API の可否、認証方法、MCP サーバ)を調査する — 結果: [docs/specs/suno-api.md](docs/specs/suno-api.md)
- [x] 2026-08-06 サードパーティ Suno API のアカウントを作成して API キーを発行し、少額クレジットで生成フローを検証する — sunoapi.org は Google ログイン不可のため同一運営の kie.ai で検証。スクリプト: `scripts/verify-sunoapi.mjs`、実測値: [docs/specs/suno-api.md](docs/specs/suno-api.md)、プラン: [docs/plans/archive/sunoapi-org-verification.md](docs/plans/archive/sunoapi-org-verification.md)
