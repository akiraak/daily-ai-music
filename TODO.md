# TODO

- エラーログ解析から修正タスクを生成する仕組みを作る(Phase 4)
  - ログの生成・保存と Mac からの取得は 2026-08-11 に導入済み([plan](docs/plans/archive/error-log-collection.md))。`GET /api/errors` / `scripts/fetch-error-logs.sh` で `.logs/` に JSONL が落ちる
  - 溜まったログを入力に「新規 fingerprint の抽出 → 原因の当たり付け → `TODO.md` への追記案」を出す仕組みを作る
  - 2〜3 週間ログを溜めてから、スラッシュコマンドにするか定期実行にするかを含めて別プランで決める

- アーティストから生成と曲から生成のUIが分かりにくいので整理して再構築

- 公開ページの曲表示に OGP タグを設定する(SNS 共有で曲名・カバー・紹介のカードを出す) [plan](docs/plans/public-track-ogp.md)
  - 現状チェック済み(2026-08-12): 曲別メタは未設定 — `/track/:id` は全曲共通の静的メタのみで、`og:title` / `og:image` / `og:url` が無い(詳細はプラン参照)
  - [ ] Phase 1: サーバー実装 — `PUBLIC_BASE_URL` + `/track/:id` の曲別メタ注入(曲名・intro・カバー)+ 不在・非公開 id の 404
  - [ ] Phase 2: 本番反映(ops 側 `.env` に `PUBLIC_BASE_URL`)+ SNS プレビューでの実地確認

- ログに追加:AIのモデルとトークン使用量