# 生成タブに生成パラメータを表示する

## 目的・背景

iOS の生成タブ(おまかせ生成)は「今日のニュース・天気とこれまでの評価(👍/👎)から、AI が 1 曲つくります」と説明するだけで、実際に生成へ入る入力(プリセットの要素プールと評価集計、今日のコンテキストの ON/OFF、冒険日確率、直近スタイル、リアルワード制限)がアプリからは見えない。管理画面には「パラメータ一覧」ページ(presets.html: 要素プール+評価集計+リアルワード使用状況)があるが、iOS には相当する画面が無い。

おまかせ生成が「何を材料に曲を決めているか」をアプリ単体で確認できるようにする。

## 現状整理(何が既に見えて、何が新規か)

`runDaily()` が LLM に注入する入力と、iOS からの現在の可視性:

| 生成入力 | サーバーでの出所 | iOS からの現状 |
|---|---|---|
| 要素プール+評価 👍/👎 集計 | `db.listPresets()` + `db.countPresetRatings()` | **見えない**(API は `GET /api/presets` に upCount/downCount 込みで存在) |
| 今日のコンテキスト(ニュース・天気 ON/OFF、都市) | `getContextSettings()` | 設定タブで閲覧・編集可 |
| 冒険日確率 | `getDailySettings().adventureProbability` | 設定タブで閲覧・編集可 |
| 直近の生成スタイル(重複回避、5 件) | `db.listRecentStyles()` | **見えない**(API 自体が無い) |
| リアルワード制限(禁止/残り 1 回) | `currentWordLimits()`(設定 `wordMaxUses`/`wordWindowDays` × 使用回数集計) | **見えない**(`GET /api/real-world-words` は存在するが iOS 未使用) |

設定タブとの役割分担: 設定タブは「値を変更する場所」、今回の画面は「生成に入る入力を一望する読み取り専用の場所」。冒険日確率やコンテキスト ON/OFF は重複表示になるが、生成入力の全体像を 1 画面で見せるために含める(編集はさせない)。

## 対応方針

### 見せ方: 生成タブから押して開く専用画面(読み取り専用)

- 生成タブの「おまかせ生成」ヒーローの直下・「カスタム生成」行の上に、既存のカスタム生成トグル行と同じ見た目の行「生成パラメータ」(副題: おまかせ生成に使われる入力)を追加し、タップで専用画面 `GenerationParamsView` へ push する(`NavigationLink`。開閉トグルではないので chevron は回転させない)
- インライン折りたたみにしない理由: 要素プールだけで数十件あり、開いたときに生成タブが縦に伸びすぎる。専用画面ならスクロールに余裕があり、生成タブは今のミニマルさを保てる
- 画面は表示のみ。編集導線は付けない(プリセット編集は管理画面、設定変更は設定タブ)

### 画面構成(上から)

1. **生成の設定** — 冒険日確率(%表示)、今日のコンテキスト(ニュース ON/OFF・天気 ON/OFF+都市名)、リアルワード制限(「直近 N 日で同一ワード M 回まで」)。ラベル+値の行形式
2. **要素プール(評価集計付き)** — カテゴリごと(categoryLabels: ジャンル/楽器/ムード/テンポ/歌声)に小見出し+ピルタグ(`WrappingPillLayout`+`PillTag` を再利用)。ピルは `labelJa` を表示し、評価があるものだけ「👍 n / 👎 n」を添える(`presetLines()` の suffix と同じ規則)
3. **直近の生成スタイル** — 5 件。`styleJa` を主(footnote)、英語 `style`(実際の注入値)を従(caption2・secondary・2 行制限)で行表示
4. **リアルワードの使用状況** — 「使用禁止(上限到達)」「残り 1 回」の 2 グループをピルタグで表示。全ワード一覧は出さず(30 日窓で最大 200 語超になり得る)、フッターに「直近 N 日で n ワードを追跡中」とだけ添える。全一覧が見たい場合は管理画面のパラメータ一覧で足りる

含めないもの: 自動生成時刻・タイムゾーン(スケジュールの設定であって生成入力ではない。設定タブにある)、インストゥルメンタルフラグ(daily は常に false の固定値)、出力条件などのプロンプト定型文(パラメータではない)。

### API: 集約エンドポイント `GET /api/generation-params` を新設

既存 3 エンドポイント(presets / settings / real-world-words)の組み合わせでも近いことはできるが、以下の理由で読み取り専用の集約エンドポイントを 1 本立てる:

- **生成入力との一致保証**: ハンドラが `runDaily()` と同じ関数(`getDailySettings` / `getContextSettings` / `db.listPresets` + `db.countPresetRatings` / `currentWordLimits`)を呼んで組み立てるので、表示が実際の生成入力とずれない。特に禁止/残り 1 回の判定を iOS 側で再実装しない(`currentWordLimits()` のしきい値ロジックがクライアントに漏れない)
- **直近スタイルはどのみち API 追加が必要**
- **iOS は 1 コールで済む**。後続 TODO「生成時の天気を削除」「毎日の自動生成で3曲生成」で入力が変わっても、変更箇所がこのハンドラと画面に局所化される

レスポンス(案):

```json
{
  "params": {
    "adventureProbability": 0.2,
    "contextNews": true,
    "contextWeather": true,
    "weatherCity": "東京",
    "presets": [
      { "id": 1, "category": "genre", "value": "city pop", "labelJa": "シティポップ", "upCount": 3, "downCount": 0 }
    ],
    "categoryLabels": { "genre": "ジャンル", "instrument": "楽器", "mood": "ムード", "tempo": "テンポ", "vocal": "歌声" },
    "recentStyles": [{ "style": "dream pop, ...", "styleJa": "ドリームポップ、…" }],
    "wordMaxUses": 2,
    "wordWindowDays": 30,
    "bannedWords": ["rain"],
    "lastChanceWords": ["neon"],
    "trackedWordCount": 42
  }
}
```

- presets は既存の `presetJson()`(集計付き)を再利用
- recentStyles 用に db.ts へ `listRecentStyleRows(limit = 5): { style, styleJa }[]` を追加(`tasks.style_ja` も引く。LLM 用の `listRecentStyles()` はそのまま残す — 注入値は英語 style のみのため)
- `GET /api/real-world-words` は管理画面(presets.js)が使い続けるので残す

## 影響範囲

- `server/src/db.ts`: `listRecentStyleRows()` 追加のみ(既存関数は不変更)
- `server/src/index.ts`: `GET /generation-params` ルート追加(api ルーターに追加するだけで `/api` と `/admin/api` の両方に載る)
- `ios/Sources/Models/APIModels.swift`: `GenerationParams` / `GenerationParamsResponse` / `RecentStyle` / `PoolPreset` を追加
- `ios/Sources/Views/GenerateView.swift`: 「生成パラメータ」行(NavigationLink)追加
- `ios/Sources/Views/GenerationParamsView.swift`: 新規
- 生成フロー・DB スキーマ・管理画面は不変更。API は追加のみなので旧サーバー×新アプリでは 404 → 画面内にエラー文言を出すだけで他機能に影響しない(本番反映はサーバーデプロイ → 実機再インストールの順なら 404 も発生しない)

## Phase 分割

### Phase 1: サーバー — GET /api/generation-params

- `db.listRecentStyleRows()` 追加
- `index.ts` に集約ハンドラ追加(`getDailySettings` / `getContextSettings` / `presetJson` + `countPresetRatings` / `currentWordLimits` / `countRealWorldWordUses().length` を組み合わせ)
- 検証: `npm run typecheck` + 実 DB のコピー(`DB_PATH` 隔離)でテストサーバーを起動し、curl で応答の各フィールドが管理画面パラメータ一覧・設定と一致することを確認

### Phase 2: iOS — 生成パラメータ画面

- APIModels にレスポンスモデル追加
- `GenerationParamsView` 新規作成(上記の 4 セクション構成。`.task` で読み込み+`.refreshable`、失敗時はエラー文言。ピルは `WrappingPillLayout`+`PillTag` を再利用)
- `GenerateView` に「生成パラメータ」行を追加(`accessibilityIdentifier: "generate.params"`)
- ScreenshotUITests に生成パラメータ画面の撮影(generate-params)を追加
- 検証: シミュレータビルド+テストサーバー(隔離 DB)に対して ScreenshotUITests をライト/ダークで実行し目視

### 完了時の後片付け

- `docs/specs/music-generation.md` の API 一覧に `GET /api/generation-params` を日付付き追記
- `CLAUDE.md` の API 一覧・iOS 画面説明を更新
- TODO → DONE 移動、本プランを `docs/plans/archive/` へ移動
- 本番反映(サーバーデプロイ → 実機再インストールの順)

## テスト方針

- サーバー: typecheck+隔離 DB のテストサーバーで curl 検証(評価集計・禁止ワードはダミー投入で確認)
- iOS: シミュレータビルド+ScreenshotUITests(ライト/ダーク)で画面の目視確認。旧サーバー相当(404)の挙動はテストサーバー無しで起動して確認

## 関連 TODO との関係(スコープ外)

- 「生成時の天気を削除」: 実施時にこの画面のコンテキスト行と API の weather 系フィールドを合わせて削る(局所変更)
- 「毎日の自動生成で3曲生成」: 生成入力自体は変わらない見込みだが、変わる場合もこのハンドラに追記するだけ
- リアルワードの全ワード一覧表示・プリセット編集機能はこの画面では持たない(管理画面の役割)
