# Web 管理画面の作成と音楽の生成・再生

## 目的・背景

iOS アプリに先行して、ブラウザから音楽生成をリクエストし、生成状況を確認し、完成した楽曲を一覧・再生できる Web 管理画面を作る。これはバックエンドの土台(Suno 連携の抽象化、生成ジョブ管理、メタデータ DB、音源の自前保存)を兼ねており、後の iOS アプリ向け API・毎日の自動生成スケジューラはこの上に載せる。

前提: kie.ai での生成フローは検証済み([docs/specs/suno-api.md](../specs/suno-api.md))。リクエスト → taskId → ポーリング → audioUrl 取得 → 即時ダウンロード保存、という流れが必要。

## 対応方針

### 技術選定

- **ランタイム**: Node.js 24(TS を直接実行できるため、ビルドステップなし)
- **フレームワーク**: Hono + @hono/node-server(TypeScript ファースト・軽量。ホスティング先未定のためランタイム可搬性の高いものを選ぶ)
- **DB**: `node:sqlite`(Node 24 で stable。ネイティブ依存なし)→ `data/db.sqlite`
- **音源保存**: ローカル `data/audio/`(プロバイダの URL は一時ファイル置き場のため即時ダウンロード必須。S3 等への移行は後続タスク)
- **フロントエンド**: `server/public/` の静的 HTML + vanilla JS(ビルドなし。管理画面なので最小限)
- **ポート**: 3014(3010〜3013 は使用済み)。`PORT` 環境変数で変更可
- **認証情報**: リポジトリ直下の `.env`(`SUNOAPI_ORG_KEY` / `SUNOAPI_BASE_URL`)を再利用

### 構成

```
server/
  package.json          # type: module, deps: hono, @hono/node-server
  tsconfig.json         # noEmit・erasableSyntaxOnly(Node の型ストリップ実行に合わせる)
  src/
    index.ts            # エントリ。API ルート + 静的配信 + ポーラー起動
    config.ts           # .env 読み込み、ポート・パス設定
    db.ts               # node:sqlite 初期化・マイグレーション・クエリ
    suno/client.ts      # SunoClient インターフェース(公式 API への差し替え口)
    suno/kieai.ts       # kie.ai / sunoapi.org 実装(Bearer 認証)
    generation.ts       # 生成ジョブ管理(タスク作成・ポーリング・MP3 保存・再開)
  public/               # 管理画面(index.html / app.js / style.css)
data/                   # gitignore 対象(db.sqlite, audio/*.mp3, images/)
```

### API

| メソッド/パス | 役割 |
|---|---|
| `POST /api/generate` | 生成リクエスト(prompt, instrumental)。DB にタスク登録しプロバイダへ送信 |
| `GET /api/tasks` | タスク一覧(状態込み。UI が進行中タスクをポーリング) |
| `GET /api/tracks` | 完成した楽曲一覧 |
| `GET /api/credits` | 残クレジット |
| `GET /audio/*` | 保存済み MP3 の配信(Range 対応=シーク可能) |

### 生成ジョブの流れ

1. `POST /api/generate` → tasks 行を作成(status=PENDING)し、プロバイダの taskId を保存
2. サーバ内のポーラー(10 秒間隔)が未完了タスクをまとめて record-info で照会し status を更新
3. SUCCESS になったら音源(と カバー画像)を `data/` にダウンロードし、tracks 行を作成して COMPLETE
4. サーバ再起動時もポーラーが未完了タスクを DB から拾って自動再開(取りこぼしなし)
5. 失敗ステータス(GENERATE_AUDIO_FAILED 等)は error として記録し UI に表示

### DB スキーマ

- `tasks(id, provider, provider_task_id, prompt, instrumental, model, status, error, created_at, updated_at)`
- `tracks(id, task_id, provider_track_id, title, duration, audio_file, image_file, created_at)`

## 影響範囲

- 新規: `server/` 一式、`data/`(gitignore)
- 変更: `.gitignore`(data/, node_modules/)、`CLAUDE.md`(コマンド・構成の追記)、`TODO.md` / `DONE.md`
- 既存コードへの影響なし(`scripts/verify-sunoapi.mjs` はそのまま残す)

## テスト方針

- `npm run typecheck`(tsc --noEmit)を通す
- API のスモーク確認: サーバ起動 → credits / tasks / tracks が返ること
- **E2E 実生成 1 回**(約 12 クレジット消費・約 2 分): 管理画面の API 経由で生成 → ポーラーが完了検知 → MP3 が `data/audio/` に保存され `/api/tracks` と `/audio/*` で再生できることを確認
- ユニットテスト基盤の整備は今回のスコープ外(バックエンド本実装のタスクで検討)

## Phase / Step

- Phase 1: バックエンド基盤(server/ セットアップ、config、DB、SunoClient 抽象化 + kie.ai 実装)
- Phase 2: 生成ジョブ管理と API(generate / tasks / tracks / credits、ポーラー、MP3 保存)
- Phase 3: Web UI(生成フォーム、進行状況表示、楽曲一覧・再生)
- Phase 4: E2E 動作確認(実生成 1 回)とドキュメント更新(CLAUDE.md・TODO/DONE・プランのアーカイブ)
