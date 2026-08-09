# 毎日の自動生成で 3 曲生成

## 目的・背景

毎日の自動生成は現在 1 日 1 曲。1 曲だとその日の当たり外れが大きく、評価(👍/👎)の集まりも遅い。1 日 3 曲に増やして選択肢と評価データを増やす。

## 対応方針

### 曲数はスケジューラのループで実現する(runDaily は 1 曲のまま)

- `runDaily()`(冒険判定 → コンテキスト → LLM → Suno で 1 曲)は**不変更**。`POST /api/daily/run` も不変更
  - 理由 1: 本番はエッジが Cloudflare のため、同期 API で 3 曲分の LLM 生成(数分)を待つとタイムアウトする。手動トリガ(管理画面・iOS のおまかせ生成)は従来どおり 1 タップ 1 曲
  - 理由 2: API 不変更なので旧アプリ×新サーバーは完全互換
- スケジューラの `tick()` が、新設定 `daily_count`(既定 3、1〜10)の残数分だけ `runDaily()` を**順次**実行する
- **進捗の記録**: 成功のたびに `last_daily_date` + 新設定キー `last_daily_count`(その日の生成済み曲数)を更新。途中で失敗しても 30 分後の再試行は残数だけ追い生成する(重複生成しない)。サーバー再起動を跨いだ場合も同様に残数から再開
  - 旧データ互換: `last_daily_date` があり `last_daily_count` が無い場合は「その日は生成済み」扱い(デプロイ当日の意図しない追い生成を防ぐ)
  - 初回起動(記録なし)は従来どおり当日を生成済み扱い(count も全数で記録)
- `shouldRunDaily()` を拡張: `{ run, localDate }` → `{ run, remaining, localDate }`。生成済み数と `dailyCount` から残数を算出

### 曲間の多様性

- 順次実行のため、2 曲目以降の LLM プロンプトには同日の前の曲のスタイル(直近スタイル)とリアルワード(uses=1 → 「残り 1 回」)が既存の仕組みでそのまま注入される — プロンプト側の変更は不要
- 1 日 3 曲になると直近スタイル 5 件では 2 日分に満たないため、`listRecentStyles` / `listRecentStyleRows` の limit を 5 → 10 に拡大

### 冒険判定は曲ごと(文言は「冒険日」を維持)

- 判定は従来どおり `runDaily()` 内で毎回実施(確率は `adventure_probability`)。1 日 3 曲では全曲一括の「冒険日」より、曲単位で散発する方が体験がなめらか(期待値は同じ)
- UI・docs の「冒険日」文言は広範に使われているため維持し、仕様書に「判定は 1 曲ごと」と注記する

## 影響範囲

- `server/src/scheduler.ts`: `DailySettings` に `dailyCount` 追加、`shouldRunDaily()` 拡張、`tick()` のループ化と進捗記録
- `server/src/db.ts`: `listRecentStyles` / `listRecentStyleRows` の limit 5 → 10
- `server/src/index.ts`: `GET /api/settings` に `dailyCount`(自動。`getDailySettings` 経由)、`PUT /api/settings` に `dailyCount` バリデーション(1〜10 の整数)
- `server/public/settings.html`: 「1 日の曲数」行を追加(`settings.js` は data-field 汎用のため不変更)
- iOS: `APIModels.swift`(`ServerSettings` / `SettingsUpdateRequest` に `dailyCount`)、`SettingsView.swift`(曲数 Picker 行)
- docs: `CLAUDE.md` 現状、`music-generation.md`(日付付き追記)、`music-generation-flow.md`(手順・設定表)。SVG 2 枚は曲数の記載が無いため不変更

### 互換性

- API は既存キー不変更+`settings` への追加キーのみ → 旧アプリ×新サーバーは完全互換(未知キーは無視される)
- 新アプリ×旧サーバーは `ServerSettings` のデコードに失敗する(dailyCount 非 optional。既存フィールドと同じ方針)→ 本番反映はサーバーデプロイ先行

## テスト方針

- `npm run typecheck`
- 隔離 DB(`DB_PATH` 指定・`daily_enabled=false`)サーバーへの curl: `GET /api/settings` に `dailyCount: 3`、`PUT` で変更反映と範囲外 400
- 使い捨てスクリプトで `shouldRunDaily()` を直接検証(残数算出・旧データ互換・部分生成からの再開)— 実生成なし
- 管理画面設定ページをヘッドレス Chrome で目視
- iOS: シミュレータビルド+SettingsUITests / ScreenshotUITests(設定タブの曲数行を目視)
