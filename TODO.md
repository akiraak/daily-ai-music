# TODO

- エラーログ解析から修正タスクを生成する仕組みを作る(Phase 4)
  - ログの生成・保存と Mac からの取得は 2026-08-11 に導入済み([plan](docs/plans/archive/error-log-collection.md))。`GET /api/errors` / `scripts/fetch-error-logs.sh` で `.logs/` に JSONL が落ちる
  - 溜まったログを入力に「新規 fingerprint の抽出 → 原因の当たり付け → `TODO.md` への追記案」を出す仕組みを作る
  - 2〜3 週間ログを溜めてから、スラッシュコマンドにするか定期実行にするかを含めて別プランで決める

- LLM トークン記録の最終確認 — 実装・本番反映済み。2026-08-13 の自動生成(PT 6:00)後にトークンが記録されていることを確認して DONE へ [plan](docs/plans/llm-token-usage-log.md)

- 生成 UI 再構築 + 生成 3 経路の本番反映 — サーバーを通常フロー(`git pull` → `build` → `up -d`)で反映(`GET /api/reference-songs` と `POST /api/generate` の `artistId` 追加のみ・DB 変更なし)し、iOS アプリを実機へ再インストール。**反映まで実機の「曲から生成」の一覧はエラー表示・「アーティストでおまかせ」の実行は 400 になる**(他の画面は旧サーバーでも動く)[plan](docs/plans/archive/generation-ui-restructure.md) / [plan](docs/plans/archive/generation-three-entries.md)

- [] 音楽になにか分類をつけてWebトップやアプリトップで絞り込みできるようにする
- アーティスト名が英語でしか出てこない。日本語になるようにする — 調査済み。iTunes の artist 行は常に英語正式表記で、日本語名は `artistLinkUrl` の slug から取る。`artists.name` は LLM・同一性用に残し、表示用 `name_ja` を追加する方針 [plan](docs/plans/artist-name-localization.md)
  - [ ] Phase 1: サーバー(`name_ja` の取得・保存・API 追加・backfill)+ 管理画面
  - [ ] Phase 2: iOS 表示(`nameJa ?? name`)