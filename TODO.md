# TODO

- エラーログ解析から修正タスクを生成する仕組みを作る(Phase 4)
  - ログの生成・保存と Mac からの取得は 2026-08-11 に導入済み([plan](docs/plans/archive/error-log-collection.md))。`GET /api/errors` / `scripts/fetch-error-logs.sh` で `.logs/` に JSONL が落ちる
  - 溜まったログを入力に「新規 fingerprint の抽出 → 原因の当たり付け → `TODO.md` への追記案」を出す仕組みを作る
  - 2〜3 週間ログを溜めてから、スラッシュコマンドにするか定期実行にするかを含めて別プランで決める

- アーティストから生成と曲から生成のUIが分かりにくいので整理して再構築

- 生成した曲を表示するWebを作る [plan](docs/plans/public-tracks-web.md)
  - [x] Phase 0: 前提調査 — Suno 生成曲の著作権・公開可否(結果はプラン参照。非商用の個人サイトなら公開可と判断)
  - [x] デザイン案の選定 — 案A(ギャラリー・ミニマル)を採用し、曲一覧+曲詳細の 2 ページ構成に拡張(モックアップ: `docs/plans/mockups/public-tracks-web/`)
  - [x] Phase 1: サーバー — `tracks.published`(既定 1 の opt-out)+ 公開 API/配信 + `PATCH /api/tracks/:id` + 公開ページ(`/` マウント)
  - [x] Phase 2: 管理画面の楽曲一覧に公開/非公開トグル
  - [ ] Phase 3: iOS の楽曲詳細に公開/非公開トグル
  - [ ] Phase 4: 本番反映(デプロイ・`/` と `/admin` の保護状態の確認)

- ログに追加:AIのモデルとトークン使用量