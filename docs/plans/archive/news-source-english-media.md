# ニュースのソースを海外の英語メディアに変更

## 目的・背景

毎日の自動生成の「今日のコンテキスト」に注入するニュースは、現在 Google News RSS の日本版(`hl=ja&gl=JP&ceid=JP:ja`)のトップニュース見出しを使っている(`server/src/context.ts` の `NEWS_RSS_URL`)。歌詞は英語で生成するため、日本の時事(日本語見出し・日本ローカルの固有名詞)よりも、海外の英語メディアの見出しの方がテーマ語(リアルワード)や雰囲気が英語歌詞に自然に馴染む。ソースを海外の英語メディアに切り替える。

## 対応方針

### ソースの選定: Google News RSS 英語版(米国版)

`NEWS_RSS_URL` を以下に変更する。

```
https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en
```

- Reuters・The Guardian・Politico・Axios 等、複数の海外英語メディアの見出しが集約されて返ることをプラン作成時に curl で確認済み
- XML 構造が現行の日本版と同一のため、パーサ(`fetchNews` の正規表現)・件数上限(`NEWS_MAX_ITEMS = 8`)・タイムアウト・失敗時スキップの挙動は一切変更しない — 変更は URL 定数 1 行+コメント・文言のみ
- 代替案として BBC 等の単一媒体 RSS も検討したが不採用: 単一媒体の編集方針に偏る上、BBC の RSS は `<title>` が CDATA 形式でパーサ調整が必要になり、変更が増えるだけで利点がない

### 変更内容

1. **`server/src/context.ts`**: `NEWS_RSS_URL` を英語版(米国版)に変更。`fetchNews` のコメント「Google News RSS(日本版トップニュース)」を米国版に更新。プロンプト内の見出しセクション(「### 今日の主なニュース(見出し)」と「この中から 1 つ選び…」の指示文)は英語見出しでもそのまま有効なため変更しない(LLM は言語混在を問題なく扱う)
2. **`server/public/settings.html`**: ニューストグルのヒント「Google News の日本版トップニュース見出し」→「Google News の米国版(英語)トップニュース見出し」
3. **`ios/DailyAIMusic/Sources/Views/SettingsView.swift`**: 同ヒント文言を同様に更新(API 変更なし。文言のみ)
4. **ドキュメント**:
   - `docs/specs/music-generation.md` の外部コンテキスト取得の項(決定の記録)に日付付きで追記
   - `docs/specs/music-generation-flow.md` の入力表「ニュース見出し(Google News RSS 上位 8 件)」を英語版(米国版)と明記する形に書き換え
   - SVG 2 枚(daily-run-steps・flow-overview)はロケール記述が無く現行のままで正確なため変更不要
   - CLAUDE.md の「現状」もロケール記述が無いため変更不要(最終確認のみ)

## 影響範囲

- サーバー: `context.ts` の定数+コメントのみ。ロジック・API・DB・設定キー(`context_news`)は不変更
- 管理画面・iOS: ヒント文言のみ。**旧アプリ×新サーバーは完全互換**(文言が古いだけで機能影響なし)— 本番反映はサーバーデプロイのみ必須、実機アプリの再インストールは任意(次の機会でよい)
- 生成内容への影響: 今日のコンテキスト由来のテーマ語・リアルワードが英語ニュース由来になる。リアルワードの使用制限ロジックは語彙非依存のため変更不要

## テスト方針

- `npm run typecheck`
- 隔離 DB(`DB_PATH` を scratchpad に向ける。設定なしのフレッシュ DB では `context_news` がデフォルト true)で `buildTodayContext()` を直接呼ぶ使い捨てスクリプトを実行し、英語見出し 8 件が「今日のコンテキスト」文字列に整形されることを確認 — daily の実生成は行わない(Suno クレジット消費と実 DB 汚染を避ける)
- 管理画面設定ページの文言をヘッドレス Chrome で目視
- iOS: シミュレータビルド+設定タブの文言を目視(ScreenshotUITests)。SettingsUITests は文言非依存のためそのまま通る想定

## 完了時の後片付け

- `TODO.md` → `DONE.md` 移動(完了日付き)、本番反映(サーバーデプロイ)を新規 TODO に追加、本プランを `docs/plans/archive/` へ移動
