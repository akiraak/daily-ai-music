# iOS アプリデザインをする

## 目的・背景

iOS アプリは機能最小版のままで、SwiftUI 標準の見た目(白背景+青ティント)にアプリの個性が無い。
アプリアイコン(黄緑の音符+芝生風イコライザ、クリーム背景)を設定したので、アプリ内の色味をアイコンに合わせ、
あわせて画面レイアウトと機能も再考する。

バックエンドの `/api/tracks` は既にリッチな情報(styleJa・歌詞・日本語訳・狙い・リアルワード等)を返しているが、
iOS は一覧表示に必要な最小フィールドしか使っておらず、見せ方に伸びしろが大きい。

## デザイントークン(アイコン実測色ベース)

アイコンからの実測値: 音符 = `#B4BA40`(オリーブライム)、背景 = `#FDF2E5`(クリーム)。

(色チップは vibeboard で表示可。GitHub 上ではチップが消え hex 文字列のみになる)

| トークン | ライト | ダーク | 用途 |
|---|---|---|---|
| `AccentColor` | <span style="display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid rgba(128,128,128,.5);vertical-align:-2px;background:#B4BA40"></span> `#B4BA40` | <span style="display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid rgba(128,128,128,.5);vertical-align:-2px;background:#C4C963"></span> `#C4C963`(少し明るく) | ティント全般(タブ・ボタン・再生中表示・評価 ON) |
| `AppBackground` | <span style="display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid rgba(128,128,128,.5);vertical-align:-2px;background:#FDF2E5"></span> `#FDF2E5` | <span style="display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid rgba(128,128,128,.5);vertical-align:-2px;background:#1C1B16"></span> `#1C1B16`(暖色系ダーク) | 画面背景 |
| `CardBackground` | <span style="display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid rgba(128,128,128,.5);vertical-align:-2px;background:#FFFFFF"></span> `#FFFFFF`(または <span style="display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid rgba(128,128,128,.5);vertical-align:-2px;background:#FFF9F0"></span> `#FFF9F0`) | <span style="display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid rgba(128,128,128,.5);vertical-align:-2px;background:#2A2822"></span> `#2A2822` | カード・リスト行の面 |
| `AccentDeep` | <span style="display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid rgba(128,128,128,.5);vertical-align:-2px;background:#787D2B"></span> `#787D2B`(アクセントの暗色) | <span style="display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid rgba(128,128,128,.5);vertical-align:-2px;background:#C4C963"></span> `#C4C963` | 明るい面の上の文字・小さい図形(`#B4BA40` は白系背景とのコントラストが弱いため文字には使わない) |
| テキスト | `.primary` / `.secondary` 標準 | 同左 | 本文・補足 |

組み合わせプレビュー(AppBackground の上に CardBackground の面、AccentColor のチップ、AccentDeep の文字):

<table><tr>
<td style="background:#FDF2E5;padding:16px;border-radius:12px;min-width:240px">
<div style="background:#FFFFFF;border-radius:10px;padding:10px 14px;box-shadow:0 1px 3px rgba(0,0,0,.08)"><span style="display:inline-block;width:32px;height:32px;border-radius:8px;background:#B4BA40;vertical-align:middle"></span> <span style="color:#787D2B;font-weight:bold">Morning Bloom</span><br><span style="color:#8a8578;font-size:12px">acoustic pop / 朝の光</span></div>
<div style="margin-top:8px;color:#787D2B;font-size:12px">ライト</div>
</td>
<td style="background:#1C1B16;padding:16px;border-radius:12px;min-width:240px">
<div style="background:#2A2822;border-radius:10px;padding:10px 14px"><span style="display:inline-block;width:32px;height:32px;border-radius:8px;background:#C4C963;vertical-align:middle"></span> <span style="color:#C4C963;font-weight:bold">Morning Bloom</span><br><span style="color:#9a968a;font-size:12px">acoustic pop / 朝の光</span></div>
<div style="margin-top:8px;color:#C4C963;font-size:12px">ダーク</div>
</td>
</tr></table>

- 実装は `Assets.xcassets` にカラーセット(Any/Dark)として定義し、`Theme.swift`(`Color` extension)でセマンティック名を付けて参照する
- フォントは SF Pro のまま、見出し系に `.rounded` デザインを使いアイコンの丸さと揃える(候補。実装時に見て判断)
- 遊び要素: 再生中インジケータをアイコン下部と同じ「芝生風イコライザ」の小アニメーションにする(スピーカーアイコンの置き換え)

## 画面レイアウト・機能の再考

### タブ構成(現状維持 + 役割整理)

「ライブラリ」「生成」「設定」の 3 タブ構成は維持。ただしライブラリをホームと位置づけ、
生成の進行状況をライブラリ上部でも見えるようにする(生成タブを開かないと進行が分からない現状を解消)。

### 1. ライブラリ(現・楽曲一覧)

- **今日の一曲ヒーローカード**: 当日生成された曲を最上部に大きく表示(大カバー+タイトル+スタイル要約+再生ボタン)。「毎朝届く」というアプリの核を画面の顔にする
- **進行中ジョブカード**: 生成中タスクがあればヒーローの上に進行状況カードを表示(5 秒ポーリングは表示中のみ)
- **リスト行の刷新**: カバー・タイトルに加えて styleJa の要約 1 行とリアルワードのピルタグ(管理画面と同等)を表示。日付でグループ化
- **行タップで詳細画面へ**(再生は行内の再生ボタンで即時)。👍/👎 は行に残す

### 2. 楽曲詳細(新設)

API が既に返している未活用データを見せる画面。

- 大カバー・タイトル・再生ボタン・👍/👎
- リアルワードのピルタグ、狙い(intent)、スタイル(styleJa、原文 style は折りたたみ)
- 歌詞: lyrics / lyricsJa の切替(セグメント)または併記
- メタ情報(生成日時・mode・Suno モデル・LLM モデル)は最下部に小さく

### 3. プレイヤー強化

- **ミニプレイヤー刷新**: カバーサムネイル追加、アクセント色適用。タップでフルプレイヤー(シート)を開く
- **フルプレイヤー(新設・シート)**: 大カバー・シークバー・前後の曲・再生/停止・歌詞へのショートカット
- **連続再生**: 曲終了で一覧の次の曲へ自動送り(現状は停止するのみ)
- **ロック画面対応**: `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter` でロック画面・コントロールセンターに曲名/カバー/操作を出す(バックグラウンド再生は対応済みだが表示・操作が未対応)

### 4. 生成タブの再考

管理画面が daily フロー(おまかせ生成)に一本化された経緯に合わせ、iOS も主役を入れ替える。

- **「おまかせ生成」ボタンを主役に**: `POST /api/daily/run`(プロファイル+今日のコンテキスト使用)を呼ぶ。管理画面の生成ボタンと同じ挙動
- 自由テキスト+インスト指定(既存の `POST /api/generate`)は「カスタム生成」として折りたたみで残す
- 残クレジット表示(`GET /api/credits`)をヘッダーに追加
- 進行状況リストは維持(ライブラリ上部のカードと同一データ)

### 5. 設定(小改修)

- サーバー接続(URL・Secret・接続テスト)は現状維持、色味のみ統一
- 任意(Phase 8): サーバー側 settings(自動生成時刻・ニュース/天気 ON/OFF・都市)の閲覧・編集(`GET/PUT /api/settings` 既存)。iPhone から自動生成設定を触れるようにする — スコープ肥大のため実装するか着手時に判断

## デザイン案の作成と選定(Phase 1)

カラーセット定義(Phase 0)のあと、画面実装に入る前に複数のデザイン案を作成し、目視チェックで 1 案(または良いとこ取りの組み合わせ)を決めてから Phase 2 以降を進める。

- **形式**: iPhone 実寸フレーム(390pt 幅)の HTML モック。案ごとに主要 4 画面(ライブラリ・楽曲詳細・フルプレイヤー・生成タブ)を並べ、ライト/ダーク両方を用意する。実データ風のダミーコンテンツ(タイトル・styleJa・リアルワードタグ・歌詞)を入れて実際の情報量で判断できるようにする
- **案数**: 3 案程度。カラートークンは Phase 0 で定義した値(CSS 変数として同じ hex を使用)で全案共通とし、トーンを変える — 例: ①ミニマル(余白広め・面はフラット)②カード強め(角丸・影で面を立てる)③遊び強め(芝生イコライザ等のモチーフを多用)
- **選定**: ブラウザで目視チェックして決定。決定した案(組み合わせの場合はその内容)をこのプランに追記し、Phase 2 以降の実装の基準にする
- モックは `docs/plans/ios-app-design-mocks/` に置き、選定後も実装時の参照として残す

### 決定(2026-08-08): 案A ミニマル

3 案(`01-minimal.html` / `02-card.html` / `03-playful.html`、コンテンツは本番の実データ・実カバー画像)を目視チェックし、**案A ミニマル**([docs/plans/ios-app-design-mocks/01-minimal.html](ios-app-design-mocks/01-minimal.html))に決定。Phase 2 以降はこのモックを基準に実装する。

案A の要点(実装基準):

- 面はフラット(`AppBackground` 一色)。カード・影は使わず、区切りはヘアライン(`separator` 相当の低コントラスト線)
- 余白広め(コンテンツ左右 22pt 目安)、タイポグラフィ主導の階層
- アクセント色は要所のみ: 再生アイコン・再生中インジケータ(芝生イコライザ、静止)・進行バー・選択中タブ・セグメント下線
- 文字色に使うのは `AccentDeep`(戻るリンク・行内再生ボタン・再生中行のタイトル等)
- ピルタグ(リアルワード・冒険日)は枠線のみの控えめ表示(冒険日のみ枠線を `AccentDeep`)
- 主要ボタン: 楽曲詳細の再生は `AccentDeep` アウトラインのピル、おまかせ生成は `AccentDeep` 塗り(ダークは `AccentColor` 塗り+暗色文字)
- ミニプレイヤー・タブバーはフラット背景+上ヘアライン。ヒーローのカバーは角丸 14pt、行カバーは 7pt 程度

## 影響範囲

- `ios/DailyAIMusic/Sources/` 全画面(ContentView・TrackListView・MiniPlayerView・GenerateView・SettingsView)+ 新設(Theme・TrackDetailView・FullPlayerView)
- `ios/DailyAIMusic/Resources/Assets.xcassets`(カラーセット追加)
- `Models/APIModels.swift`(Track に styleJa・lyrics・lyricsJa・intent・realWorldWords 等を追加 — API は変更不要)
- `Services/PlayerService.swift`(連続再生・Now Playing 対応)
- サーバー側は変更なし(既存 API のみ使用)

## Phase 分割

- Phase 0: カラーセット定義 — Assets.xcassets カラーセット(ライト/ダーク)+ Theme.swift のセマンティック名定義(画面への適用は Phase 2 以降)
- Phase 1: デザイン案の作成・選定 — Phase 0 のカラートークンを使った HTML モックで 3 案程度を作成し、目視チェックで決定(上記「デザイン案の作成と選定」)
- Phase 2: デザイン基盤の適用 — 決定した案に沿って全画面へアクセント/背景を適用
- Phase 3: ライブラリ刷新 — 今日の一曲ヒーロー・進行中ジョブカード・リスト行(styleJa/タグ)・日付グループ
- Phase 4: 楽曲詳細画面 — 歌詞・訳・狙い・タグ・メタ情報・評価
- Phase 5: プレイヤー強化 — ミニプレイヤー刷新・フルプレイヤーシート・連続再生・ロック画面 Now Playing
- Phase 6: 生成タブ再考 — おまかせ生成(daily/run)主役化・カスタム生成折りたたみ・クレジット表示
- Phase 7: 設定の色味統一 + 仕上げ(芝生イコライザアニメ等の遊び要素)
- Phase 8(任意): サーバー設定の閲覧・編集

## テスト方針

- 各 Phase でシミュレータビルド(`xcodebuild build`)を通す
- 見た目の確認はシミュレータ + XCUITest のスクリーンショット(cliclick は使わない)。ライト/ダーク両方
- 既存 XCUITest スモーク(一覧 → タップ → 再生)を維持。行タップの遷移先が詳細画面に変わるため、テストの再生導線を行内再生ボタンに合わせて更新する
- 連続再生・ロック画面表示は実機(`./run-ios-device.sh`)で確認
