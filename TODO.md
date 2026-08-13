# TODO

- エラーログ解析から修正タスクを生成する仕組みを作る(Phase 4)
  - ログの生成・保存と Mac からの取得は 2026-08-11 に導入済み([plan](docs/plans/archive/error-log-collection.md))。`GET /api/errors` / `scripts/fetch-error-logs.sh` で `.logs/` に JSONL が落ちる
  - 溜まったログを入力に「新規 fingerprint の抽出 → 原因の当たり付け → `TODO.md` への追記案」を出す仕組みを作る
  - 2〜3 週間ログを溜めてから、スラッシュコマンドにするか定期実行にするかを含めて別プランで決める

- アーティストから生成と曲から生成のUIが分かりにくいので整理して再構築

- ログに追加:AIのモデルとトークン使用量 [plan](docs/plans/llm-token-usage-log.md)
  - モデル名は `tasks.llm_model` に記録済み。トークン使用量が console にしか出ない(docker logs はローテートで消える)ので、タスク行に永続化して管理画面に表示する
  - [x] Phase 1: サーバー実装(`tasks` に入力/出力トークン・web_search 回数を合算記録)+ 管理画面表示 + 隔離 DB での検証
  - [x] Phase 2: 本番反映(2026-08-12 実施。新フィールドが API に出ること・旧データが null なことを確認済み)
  - [ ] 2026-08-13 の毎日の自動生成(PT 6:00)後に、トークンが実際に記録されていることを確認して DONE へ