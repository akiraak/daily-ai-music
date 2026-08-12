# TODO

- エラーログ解析から修正タスクを生成する仕組みを作る [plan](docs/plans/error-log-collection.md)
  - [ ] Phase 1: サーバーのエラーを構造化して保存する(`error_logs` テーブル + `logError()`)
  - [ ] Phase 2: Mac から取得できるようにする(`GET /api/errors` + `scripts/fetch-error-logs.sh`)
  - [ ] Phase 3: iOS アプリのエラーをサーバーへ送る(`POST /api/client-errors`)
  - [ ] Phase 4: 溜まったログの解析 → 修正タスク生成(内容は Phase 1〜3 の後に決める)
