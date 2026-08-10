# 管理画面にモデル表示と effort 切り替えを追加(実装プラン)

## 目的・背景

生成の頭脳である LLM は `.env` の `LLM_MODEL`(既定 `claude-sonnet-5`)で決まるが、管理画面のどこにも出ていないため「いま何で生成しているか」が画面から分からない。あわせて Claude の **`output_config.effort`**(思考の深さと全体のトークン消費を制御する GA パラメータ。`low` / `medium` / `high` / `xhigh` / `max` の 5 段階、未指定時は `high`)を現在は指定していないので、コスト・品質・所要時間のつまみが無い。

この 2 つを設定ページ(`/admin/settings.html`)に入れる。effort は他の生成パラメータ(冒険日確率・ニュース ON/OFF)と同じく `settings` テーブルに置き、次の生成から即反映する。

## 対応方針

### 1. モデルは読み取り専用の表示にする

`LLM_MODEL` は `.env`(と本番の環境変数)が真実源。DB 設定にすると env と二重管理になり、どちらが効いているのか分からなくなるうえ、存在しないモデル名を画面から保存できてしまう。**表示のみ**にして、変更方法(`.env` の `LLM_MODEL` + サーバー再起動)をヒントに書く。Suno のモデル(`SUNO_MODEL`、既定 `V5`)も同じ理由で同じ扱いにし、同じパネルに並べる。

### 2. effort は `settings` テーブルの `llm_effort`

- 既定は `high`(API の既定と同じ。未設定の既存 DB でも挙動が変わらない)
- 値は `low` / `medium` / `high` / `xhigh` / `max` の 5 つ。定義は `llm.ts` に置き、API のバリデーションと画面の選択肢がそこを参照する
- 読み出しは生成のたび(`requestSongPlan()` 内)。保存値をキャッシュしないので、設定変更が次の生成にそのまま効く — 既存の `currentWordLimits()` / `getDailySettings()` と同じステートレス方式
- 全モード共通(daily / manual / artist)。参照曲あり/なしで出し分けはしない(下記「非目標」)

### 3. `max_tokens` を effort 連動にする(必須)

`max_tokens` は**思考と本文の合算の上限**で、現在は 16000 固定。`xhigh` / `max` を画面から選べるようにすると、思考がこの枠を食って JSON が途中で切れる(`stop_reason: "max_tokens"` → `JSON.parse` 失敗 → タスク `FAILED`)危険が上がる。歌詞(英日)+ style + styleJa + intent と出力自体が長いスキーマなので余裕は多くない。

**当初の案**: `low` / `medium` / `high` → 16000、`xhigh` / `max` → 32000。非ストリーミングのままでよい(SDK が大きい `max_tokens` のタイムアウトを自動で伸ばすと想定)。

**実測で判明した誤り(2026-08-10)**: TypeScript SDK は自動で伸ばさず、**`max_tokens` が 21,333(`60分 × max_tokens ÷ 128000 > 10分`)を超える非ストリーミング要求を送信前に例外**にする(`Streaming is required for operations that may take longer than 10 minutes`)。実生成が即 `FAILED` になって発覚した。ガードはクライアントに明示 `timeout` があるときだけ回避される。

**確定した方針**: 上限は effort によらず **32,000 の一本**にし、呼び出しを **ストリーミング(`messages.stream().finalMessage()`)** に変える。実測の裏づけ — effort=max の出力は 1 曲目 15,639 / 2 曲目 20,139 トークンと振れ幅が大きく、旧上限 16,000 では 2 曲目が切れていた(= JSON パース失敗 → タスク `FAILED`)。応答の扱いは `finalMessage()` で非ストリーミングと同じで、`web_search` の server tool ブロックも同様に積まれる。

### 4. API は追加のみ

`GET /api/settings` の応答に `llmModel` / `sunoModel`(読み取り専用)と `llmEffort` を足す。`PUT` は `llmEffort` だけ受け付け、5 値以外は 400。既存キーの形状は変えないので、iOS の旧アプリでもデコードは通る(Swift の `Decodable` は未知のキーを無視する)。

### 5. 画面

設定ページの先頭に「曲の生成(LLM)」パネルを新設する。

| 行 | 種類 | 内容 |
|---|---|---|
| LLM モデル | 読み取り専用 | 例: `claude-sonnet-5`。ヒントに「`.env` の `LLM_MODEL` で変更(サーバー再起動が必要)」 |
| 思考の深さ(effort) | `<select>` | 5 段階。ヒントに「深いほど品質が上がるがトークンと時間が増える。既定は high」 |
| Suno モデル | 読み取り専用 | 例: `V5`。ヒントに「`.env` の `SUNO_MODEL` で変更」 |

`settings.js` は `data-field` を持つ要素を総なめして PUT する汎用実装なので、**`<select>` は JS 変更なしで動く**(`el.value` を読み、`applySettings` が `el.value` に書き戻す)。読み取り専用の表示だけ `data-readonly-field` 属性を足して `textContent` に流す数行を追加する。`.setting-inputs select` の CSS は既にあるので、値表示用の `.setting-value` だけ追加する。

## 影響範囲

| ファイル | 変更 |
|---|---|
| `server/src/llm.ts` | effort の値定義・`getLlmSettings()`・`output_config.effort` の付与・`max_tokens` の effort 連動 |
| `server/src/index.ts` | `allSettings()` にキー追加、`PUT /api/settings` に `llmEffort` のバリデーション |
| `server/public/settings.html` | 「曲の生成(LLM)」パネルを新設 |
| `server/public/settings.js` | `data-readonly-field` の描画(数行) |
| `server/public/style.css` | `.setting-value` を追加 |
| `CLAUDE.md` / `docs/specs/music-generation.md` / `docs/specs/music-generation-flow.md` | モデル表示と effort 設定の記述 |

DB のスキーマ変更は無し(`settings` は key-value)。生成ロジック(`generation.ts` / `scheduler.ts`)も不変更。

## テスト方針

- `npm run typecheck`
- **実 API での疎通**(最重要): scratchpad の使い捨てスクリプトで `claude-sonnet-5` に `output_config: { effort, format }` を 5 段階すべてで投げ、200 が返り JSON がパースできることを確認する。`effort` が API/SDK に弾かれると全生成が 400 で落ちるため、画面より先にここを押さえる
- **隔離 DB のテストサーバー**(`sqlite3 .backup`・`daily_enabled=false`・ポート 3015)で curl:
  - `GET /admin/api/settings` が `llmModel` / `sunoModel` / `llmEffort` を返し、未設定の DB で `llmEffort` が `high` になること
  - `PUT` で 5 値が保存でき、不正値(`ultra` 等)が 400 で DB が変わらないこと
  - `llmModel` を PUT しても無視される(読み取り専用)こと
  - 既存キー(`dailyCount` 等)の更新に回帰が無いこと
  - **通しの実生成 1 曲**(参照曲なし = 検索なしで安価)を既定以外の effort で行い、`COMPLETE` すること
- 管理画面をヘッドレス Chrome の CDP 操作で目視(パネルの表示・select の変更 → 保存メッセージ → リロードで保持)

## 非目標(今回はやらない)

- iOS の設定画面への反映(API は追加済みなので後から乗せられる)
- タスクごとの effort 記録(`tasks.llm_effort`)と楽曲詳細への表示 — どの曲がどの effort で生成されたかの追跡
- 参照曲あり / なしでの effort 出し分け(検索の深さを effort で変える案)
- モデル自体を画面から切り替える(env が真実源のまま)
