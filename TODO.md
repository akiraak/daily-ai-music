# TODO

- エラーログ解析から修正タスクを生成する仕組みを作る(Phase 4)
  - ログの生成・保存と Mac からの取得は 2026-08-11 に導入済み([plan](docs/plans/archive/error-log-collection.md))。`GET /api/errors` / `scripts/fetch-error-logs.sh` で `.logs/` に JSONL が落ちる
  - 溜まったログを入力に「新規 fingerprint の抽出 → 原因の当たり付け → `TODO.md` への追記案」を出す仕組みを作る
  - 2〜3 週間ログを溜めてから、スラッシュコマンドにするか定期実行にするかを含めて別プランで決める

- アーティストから生成と曲から生成のUIが分かりにくいので整理して再構築

- Webの曲の詳細ページに曲の短い紹介と歌詞を表示 [plan](docs/plans/public-track-intro-lyrics.md)
  - [ ] Phase 1: サーバー — `tasks.intro`(公開用の紹介文)+ 一覧 API に intro + `GET /site/api/tracks/:id`(intro + セクションタグを落とした歌詞)
  - [ ] Phase 2: 公開ページに表示(曲詳細は紹介・歌詞、トップの一覧カードは紹介 2 行クランプ。管理画面には intro の表示だけ足す)
  - [ ] Phase 3: 既存 36 曲のバックフィルスクリプト(参照曲を入力に渡さず Haiku で生成。開発機で文面確認まで)
  - [ ] Phase 4: 本番反映(デプロイ → バックフィル実行 → 公開・非公開の確認)

- ログに追加:AIのモデルとトークン使用量