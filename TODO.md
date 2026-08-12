# TODO

- エラーログ解析から修正タスクを生成する仕組みを作る(Phase 4)
  - ログの生成・保存と Mac からの取得は 2026-08-11 に導入済み([plan](docs/plans/archive/error-log-collection.md))。`GET /api/errors` / `scripts/fetch-error-logs.sh` で `.logs/` に JSONL が落ちる
  - 溜まったログを入力に「新規 fingerprint の抽出 → 原因の当たり付け → `TODO.md` への追記案」を出す仕組みを作る
  - 2〜3 週間ログを溜めてから、スラッシュコマンドにするか定期実行にするかを含めて別プランで決める

- アーティストの曲は有効なものと無効なものに分ける([plan](docs/plans/artist-song-enabled-flag.md))
  曲一覧で有効無効を設定できるようにする
  生成は有効な曲からしか行わない
  - [x] Phase 1: サーバー(`artist_songs.enabled` 追加・取り込み時にノイズ判定を反映・実行時のノイズ除外を廃止・`PATCH` 2 本・無効曲は 409)
  - [x] Phase 2: Web 管理画面の曲一覧に有効/無効の切り替えと一括操作
  - [x] Phase 3: iOS の曲一覧に有効/無効のトグルと表示フィルタ
  - [ ] Phase 4: 本番反映(DB バックアップ → 再起動でマイグレーション)と CLAUDE.md 更新
    - CLAUDE.md 更新と DB バックアップ(`data/backup-20260812-before-enabled.sqlite`)は完了。残りは g3plus での `git pull` → `build` → `up -d` と反映後の確認

- 生成した曲を表示するWebを作る
  前提としてSunoで生成した曲に著作権があるか確認