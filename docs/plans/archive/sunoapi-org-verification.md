# sunoapi.org 生成フロー検証プラン

## 目的・背景

Suno 連携の第一候補である sunoapi.org([調査結果](../specs/suno-api.md))について、
実際にアカウントを作成し、少額クレジットで「生成リクエスト → ポーリング → 音源取得」の
一連のフローが動くことを確認する。バックエンド実装(`SunoClient` 抽象化)の前提検証。

## 対応方針

依存ゼロの Node スクリプト(`scripts/verify-sunoapi.mjs`)で以下を通しで実行する。

1. `GET /api/v1/generate/credit` — 残クレジット確認(認証の疎通確認を兼ねる)
2. `POST /api/v1/generate` — 非カスタムモード・短いプロンプトで生成リクエスト → `taskId` 取得
   - `callBackUrl` はスキーマ上必須のためプレースホルダ URL を渡し、完了検知はポーリングで行う
3. `GET /api/v1/generate/record-info?taskId=...` — 15 秒間隔でポーリング(タイムアウト 10 分)
4. `SUCCESS` 到達後、`audioUrl` から MP3 を `output/` にダウンロード
5. 再度クレジットを確認し、消費量を記録する

- API キーは `.env` の `SUNOAPI_ORG_KEY`(gitignore 済み)から読む
- ベース URL: `https://api.sunoapi.org`、認証: `Authorization: Bearer <key>`
- モデルは `V5` を使用(1 生成 ≈ 10 クレジット前後、2 曲返る想定)

## Phase / Step

- **Phase 1: 準備(ユーザー操作)** — https://sunoapi.org/ でアカウント作成、最少額($5 / 1,000 クレジット)を購入、https://sunoapi.org/api-key で API キーを発行し `.env` に `SUNOAPI_ORG_KEY=...` として保存
- **Phase 2: 検証スクリプト作成** — `scripts/verify-sunoapi.mjs` を実装
- **Phase 3: 実行・記録** — スクリプトを実行し、所要時間・クレジット消費・レスポンス形式の実測を `docs/specs/suno-api.md` に追記

## 影響範囲

- 新規: `scripts/verify-sunoapi.mjs`、`.env`(ローカルのみ)、`output/`(ローカルのみ)
- 変更: `.gitignore`(`output/` 追加)、検証後に `docs/specs/suno-api.md` へ実測値を追記
- 既存コードへの影響なし(コード未実装のため)

## テスト方針

スクリプトの実行そのものが検証。成功条件:

- クレジット残高が取得できる(認証 OK)
- 生成タスクが `SUCCESS` に到達し、`audioUrl` から再生可能な MP3 が取得できる
- 消費クレジットが想定(1 リクエスト ≈ 10 クレジット前後)と大きく乖離しない
