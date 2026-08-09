# 生成時の天気を削除

## 目的・背景

毎日の自動生成の「今日のコンテキスト」はニュース+天気(Open-Meteo)を注入しているが、天気は生成への寄与が薄いため削除する(TODO「生成時の天気を削除」)。コンテキストはニュースのみに一本化する。

## 対応方針

天気に関するコード・UI・設定項目を全て削除する。DB の `settings` テーブルに残る `context_weather` / `weather_city` / `weather_lat` / `weather_lon` 行は残置する(コードから参照されなくなるだけで無害。廃止済み `profile` テーブルと同じ扱い)。

互換性: 旧アプリ×新サーバーでは設定タブ・生成パラメータ画面のデコードが失敗しエラー表示になるが、本番反映は「サーバーデプロイ+実機再インストールをセットで行う」運用のため許容する(他機能への影響は無し)。

## Step

### Step 1: サーバー

- `src/context.ts`: 天気ソース(`fetchWeather` / `weatherLabel` / SOURCES の weather エントリ)と `ContextSettings` の `contextWeather` / `weatherCity` / `weatherLat` / `weatherLon` を削除。冒頭コメントの「ニュース・天気」をニュースのみに修正
- `src/index.ts`: `PUT /api/settings` の weather 系バリデーション(contextWeather / weatherCity / weatherLat / weatherLon)を削除、コメントの受付フィールド一覧も修正。`GET /api/generation-params` の応答から `contextWeather` / `weatherCity` を削除(`GET /api/settings` は `getContextSettings()` 経由で自動的に消える)
- `src/scheduler.ts` / `src/llm.ts`: コメントの「ニュース・天気」を修正

### Step 2: 管理画面

- `public/settings.html`: 「天気」トグル行・「天気の都市」セレクト行を削除、説明文の「ニュース・天気」を修正
- `public/settings.js`: `CITIES` / `citySelect` / `applyCity` と都市保存ロジックを削除、冒頭コメント修正

### Step 3: iOS

- `Models/APIModels.swift`: `GenerationParams` / `ServerSettings` / `SettingsUpdateRequest` から weather 系フィールドを削除、ドキュメントコメント修正
- `Views/SettingsView.swift`: 「天気」トグル・「天気の都市」ピッカー・`cityBinding`・`WeatherCity` 構造体と都市リストを削除、説明文修正
- `Views/GenerationParamsView.swift`: `contextValue` をニュースのみに
- `Views/GenerateView.swift`: 説明文「今日のニュース・天気と…」を修正
- `DailyAIMusicUITests/SettingsUITests.swift`: `settings.weatherCity` の存在アサーションを削除

### Step 4: ドキュメント

- `docs/specs/music-generation.md`(決定の記録): 日付付き追記スタイルで天気削除を記録(生成フロー手順 3・settings のデータモデル記述)
- `docs/specs/music-generation-flow.md`(挙動の説明): 現行動作(ニュースのみ)へ書き換え
- SVG 2 枚(`daily-run-steps.svg` / `flow-overview.svg`)の天気の文言を削除
- `CLAUDE.md` 現状の「外部コンテキスト(ニュース・天気)」を修正

## 影響範囲

- 毎日の自動生成のプロンプトから「今日の天気」セクションが消える(次の生成から)
- `GET/PUT /api/settings` と `GET /api/generation-params` の応答から weather 系フィールドが消える
- 管理画面設定ページ・iOS 設定タブ・生成パラメータ画面から天気の表示・操作が消える
- DB の weather 系 settings 行は孤児として残る(無害)

## テスト方針

- `npm run typecheck`
- 実 DB スナップショット(`sqlite3 .backup`。cp は WAL の罠)の隔離サーバー(`daily_enabled=false` 投入)で curl — `GET /api/settings` / `GET /api/generation-params` に weather 系が無いこと、`PUT /api/settings` で weatherCity 送信が 400 になること、`contextNews` の更新が通ること
- iOS シミュレータビルド+ScreenshotUITests(設定・生成パラメータ画面)で表示確認
- 管理画面設定ページをヘッドレス Chrome で描画確認
