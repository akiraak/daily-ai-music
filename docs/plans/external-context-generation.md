# 曲の歌詞や曲調を外部リソース(ニュース・天気)を参考にして作る

## 目的・背景

毎日の自動生成は現在、プリセットプール+好みプロファイル+直近スタイル(重複回避)だけを
LLM に渡しており、「その日ならでは」の要素が無い。外部リソースを取得して LLM プロンプトに
注入し、その日の世界を反映した歌詞・曲調にする。**ソースはニュースと天気の 2 つに絞る**(決定済み)。

## 対応方針

### アーキテクチャ

- 新モジュール `server/src/context.ts` に「コンテキストソース」を並べる。各ソースは
  `{ name, enabled 判定, fetch(): Promise<string | null> }` の小さな関数で、失敗したら null
  (**外部取得の失敗で毎日の生成を止めない**。タイムアウト数秒+エラーは警告ログのみ)
- `runDaily()` で `generateSongPlan` の前に全ソースを並行取得し、得られたものだけを
  `## 今日のコンテキスト(歌詞・曲調の着想に使う。ニュースの報告ではなく、雰囲気やテーマとして
  さりげなく織り込む)` セクションとしてプロンプトに追加する(`llm.ts` に `extraContext?: string`
  を足すだけ)
- 追加の LLM コールはしない(見出し・天気をそのまま渡し、選別・消化は既存の
  generateSongPlan の 1 コールに任せる)
- 注入内容は既存の `tasks.llm_prompt`(LLM 入力全文)に自然に記録されるので、
  管理画面の楽曲詳細から「その日何を参考にしたか」を確認できる
- ソースごとの ON/OFF は `settings` テーブル(`context_news` / `context_weather`)+
  `PUT /api/settings` で管理する。生成時(runDaily → コンテキスト収集)に毎回設定を読むため、
  切替は次の生成から即座に効く(サーバー再起動不要)

### パラメータ設定画面(管理画面に新設)

外部ソースの ON/OFF を管理画面から切り替えるための設定画面を新設する。

- **`server/public/settings.html` + `settings.js`**(パラメータ一覧ページと同じ独立ページ構成。
  ヘッダーのナビリンクでトップ・パラメータ一覧と相互リンク)
- 表示・操作:
  - **外部ソース**: ニュース ON/OFF トグル、天気 ON/OFF トグル、天気の位置(緯度経度。既定: 東京)
  - 変更は `PUT /admin/api/settings` で即保存し、保存結果を反映表示(専用の保存ボタンは置かず
    トグル操作で即時保存。評価ボタンと同じ操作感)
- `GET/PUT /api/settings` のレスポンス・検証に `contextNews` / `contextWeather` /
  `weatherLat` / `weatherLon` を追加する
- 既存の毎日の自動生成設定(実行時刻・冒険確率など)は現状 UI が無いが、この画面に同居させると
  自然なので **同じ画面に「毎日の自動生成」セクションとして追加する**(dailyEnabled /
  dailyHour / dailyTimezone / adventureProbability。API は既存のまま)

### Phase 1: 注入基盤 + ニュース + パラメータ設定画面

- `context.ts` の枠組みと `generateSongPlan` へのセクション注入
- **Google News RSS(日本版トップニュース、キー不要)**:
  `https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja`。代替: NHK ニュース RSS
- 見出し+概要を上位 5〜8 件に整形して渡す。LLM には「1 つ選んで雰囲気・テーマとして
  織り込む(時事の固有名詞を歌詞に直接入れない)」と指示
- 重い事件・訃報などをそのまま曲にしない緩衝として、上記の「さりげなく」指示で吸収する
- **パラメータ設定画面を新設**(settings.html / settings.js + ナビリンク)。この Phase では
  ニュース ON/OFF トグルと「毎日の自動生成」セクションを載せる

### Phase 2: 天気

- **Open-Meteo(キー不要・無料)** で当日の天気・気温 → ムード/テンポの着想に
- 位置は `settings` に緯度経度で追加(既定: 東京)
- 設定画面に天気 ON/OFF トグルと位置入力を追加

## 影響範囲

- `server/src/context.ts`(新規)、`scheduler.ts`(runDaily でコンテキスト取得)、
  `llm.ts`(`extraContext` 受け取り)
- `settings`(キー追加のみ。スキーマ変更なし)、`index.ts` の GET/PUT /api/settings 検証
- 管理画面: `settings.html` / `settings.js`(新規)、`index.html` / `presets.html`(ナビリンク追加)
- iOS・`POST /api/generate`(manual)は変更なし

## テスト方針

- 各 Phase: `npm run typecheck` + コンテキスト取得関数の単体実行(実 RSS/API を叩いて整形結果を目視)
- 失敗系: 到達不能 URL に差し替えてもプロンプト組み立てが従来どおり成功する(セクション無しになる)こと
- 設定画面: ヘッドレス Chrome で表示確認 + トグル切替が `GET /admin/api/settings` に反映されること、
  OFF にしたソースのセクションがプロンプト組み立てに入らないこと
- E2E(実生成 1 回・クレジット消費)は Phase 1 完了時に管理画面の生成ボタンで実施し、
  楽曲詳細の LLM 入力全文にコンテキストが入っていること・歌詞に反映されていることを確認

## 見送ったアイデア(将来検討する場合は個別プラン化)

暦・季節・祝日 / 今日は何の日(Wikipedia)/ 月齢・日の出日の入り / 音楽トレンド(Spotify)/
名言・詩(ZenQuotes・青空文庫)/ ユーザーのカレンダー(Google Calendar)/ iOS からの位置情報連携
