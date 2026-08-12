# TODO

- エラーログ解析から修正タスクを生成する仕組みを作る [plan](docs/plans/error-log-collection.md)
  - [x] Phase 1: サーバーのエラーを構造化して保存する(`error_logs` テーブル + `logError()`)
  - [x] Phase 2: Mac から取得できるようにする(`GET /api/errors` + `scripts/fetch-error-logs.sh`)
  - [x] Phase 3: iOS アプリのエラーをサーバーへ送る(`POST /api/client-errors`)
  - [ ] Phase 1〜3 の本番反映(g3plus のデプロイ + 実機アプリの更新)
  - [ ] Phase 4: 溜まったログの解析 → 修正タスク生成(内容は Phase 1〜3 の後に決める)
