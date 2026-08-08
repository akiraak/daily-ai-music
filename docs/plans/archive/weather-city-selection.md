# 天気の位置を座標入力ではなく都市名で選択できるようにする

## 目的・背景

設定ページの天気の位置は緯度・経度の数値入力で、一般ユーザーには扱いづらい。
都市名で選ぶ方式に変更する。

## 調査結果(方式選定)

フリーテキスト検索型のジオコーディングを検討したが、日本語入力に難があり見送り:

- **Open-Meteo Geocoding API**: 日本語表記のクエリ(「東京」)にヒットしない
  (ローマ字 "Tokyo" なら日本語名で返る)。CORS は対応
- **国土地理院 AddressSearch**: 日本語対応だが前方一致が粗く「東京」で北海道の「東○○」が
  先頭に来るなど候補品質が悪い

→ **47 都道府県庁所在地のドロップダウン(select)**を採用。座標はプラン作成時に
Open-Meteo Geocoding(ローマ字クエリ+country_code=JP フィルタ)で一括取得して
`settings.js` に定数として埋め込む(実行時の外部 API 依存なし・確実に動く)。

## 対応方針

- **設定**: `weather_city`(表示用の都市名。既定「東京」)を settings に追加。
  天気取得の真実源は従来どおり `weather_lat` / `weather_lon` で、都市選択時に
  都市名+座標を 1 回の PUT で同時保存する(名前と座標の不整合を防ぐ)
- **設定ページ UI**: 「天気の位置(緯度・経度入力)」行を「天気の都市」の select に置き換え。
  保存済みの都市名がリストに無い場合(旧データで座標だけ変更済み等)は
  「<現在値>(現在の設定)」オプションを先頭に足して選択状態にする
- **プロンプト注入**: `context.ts` の天気セクション見出しを `### 今日の天気(<都市名>)` にして
  LLM にも場所を伝える
- **API**: `PUT /api/settings` に `weatherCity`(1〜100 文字)を追加。
  `GET /api/settings` のレスポンスにも含める。`weatherLat` / `weatherLon` の直接指定は互換のため存置

## 影響範囲

- `server/src/context.ts`(weatherCity 設定+天気見出し)、`index.ts`(weatherCity 検証)
- `server/public/settings.html` / `settings.js`(都市 select)
- `docs/specs/music-generation.md`(settings キー追記)
- iOS・DB スキーマは変更なし(settings は key-value)

## テスト方針

- 47 都市の座標一括取得スクリプトの結果を目視確認(県庁所在地の妥当な座標か)
- 隔離 DB で `buildTodayContext` の天気見出しに都市名が入ること
- 隔離サーバーで `PUT /api/settings` の weatherCity 保存・検証(不正値 400)
- ヘッドレス Chrome で設定ページの表示確認
