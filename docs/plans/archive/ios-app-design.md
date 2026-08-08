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

3 案(`01-minimal.html` / `02-card.html` / `03-playful.html`、コンテンツは本番の実データ・実カバー画像)を目視チェックし、**案A ミニマル**([docs/plans/ios-app-design-mocks/01-minimal.html](../ios-app-design-mocks/01-minimal.html))に決定。Phase 2 以降はこのモックを基準に実装する。

案A の要点(実装基準):

- 面はフラット(`AppBackground` 一色)。カード・影は使わず、区切りはヘアライン(`separator` 相当の低コントラスト線)
- 余白広め(コンテンツ左右 22pt 目安)、タイポグラフィ主導の階層
- アクセント色は要所のみ: 再生アイコン・再生中インジケータ(芝生イコライザ、静止)・進行バー・選択中タブ・セグメント下線
- 文字色に使うのは `AccentDeep`(戻るリンク・行内再生ボタン・再生中行のタイトル等)
- ピルタグ(リアルワード・冒険日)は枠線のみの控えめ表示(冒険日のみ枠線を `AccentDeep`)
- 主要ボタン: 楽曲詳細の再生は `AccentDeep` アウトラインのピル、おまかせ生成は `AccentDeep` 塗り(ダークは `AccentColor` 塗り+暗色文字)
- ミニプレイヤー・タブバーはフラット背景+上ヘアライン。ヒーローのカバーは角丸 14pt、行カバーは 7pt 程度

### Phase 2 実装メモ(2026-08-08)

既存レイアウトのまま色基盤を全画面へ適用した。適用ルール:

- 画面背景 = `AppBackground`。List/Form は `.scrollContentBackground(.hidden)` + `.listRowBackground(Color.appBackground)` でフラット化(行区切りは標準 separator のヘアライン)
- コントロール既定ティント = `AccentColor`(ContentView ルートの `.tint(.appAccent)`)
- `AccentDeep` を使う場所: ナビの文字ボタン(`UINavigationBar.appearance().tintColor`)、タブ選択中ラベル、文字ボタン(生成する・接続テストは `.tint(.accentDeep)`)、再生中行のタイトル
- タブ選択中アイコン = `AccentColor`(`UITabBarAppearance`。バー背景は標準のまま)
- ミニプレイヤー: `.bar` 素材 → フラット `AppBackground` + 上ヘアライン(`Divider` overlay)

ハマりどころ(iOS 26 シミュレータで確認。以降の Phase でも注意):

- `UINavigationBarAppearance` で背景を上書きすると NavigationStack の大タイトルが描画されなくなる → ナビバーの背景・影には触らない(tintColor のみ変更可)
- `ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME: AccentColor` は project.yml に追加済みだが実行時ティントに反映されなかった → SwiftUI 側の `.tint(.appAccent)` で明示するのが確実
- Button 内の `.primary`/`.secondary`(階層スタイル)はティント由来の色に解決される(青/オリーブがかる)→ 固定の文字色には具体色 `Color.primary`/`Color.secondary` を使う
- スクリーンショット検証は `ScreenshotUITests`(全タブ+再生中を添付、`xcresulttool export attachments` で取り出し)。ダークは `-UIUserInterfaceStyle` 起動引数が効かないため `xcrun simctl ui <sim> appearance dark` で切り替えて撮り直す(接頭辞はシェル環境変数 `TEST_RUNNER_SCREENSHOT_STYLE` で渡す)

### Phase 3 実装メモ(2026-08-08)

ライブラリを List からScrollView + LazyVStack(横パディング 22pt、ヘアラインは Divider)へ作り替え、モックの構成を実装した。

- **今日の一曲ヒーロー**: 当日生成の最新曲(端末タイムゾーンで判定)。カバー角丸 14pt + 右下に再生/一時停止の円形ボタン(AppBackground 92% + AccentDeep)。タイトル・styleJa 1 行・ピル(冒険日 + リアルワード先頭 4 + 「+N」)
- **進行中ジョブカード**: `/api/tasks` を表示中のみ 5 秒ポーリング(`.task` がタブ離脱でキャンセル)。ジョブ完了を検知したら楽曲一覧を再読込。進行バーは実進捗が取れないためステータス段階のおおよその値(PENDING 0.1 → TEXT_SUCCESS 0.45 → FIRST_SUCCESS 0.7 → SUCCESS 0.9)、経過時間は TimelineView で 1 秒ごとに更新
- **リスト行**: カバー 52pt/角丸 7pt、タイトル、styleJa 1 行(無い旧データは モード表記にフォールバック)、ピル(冒険日 + ワード先頭 3)。右列に行内再生ボタン(再生中は静止イコライザ `EqualizerBars`)と 👍/👎。日付グループ(今日/昨日/M月d日(E)、ja_JP 固定)
- モデル拡張: `Track` に mode・styleJa・lyrics(Ja)・intent・sunoModel・llmModel・realWorldWords 等(Phase 4 で使用)、`GenerationTask` に mode。タブ名を「楽曲」→「ライブラリ」に変更
- UI テスト: 行タップは Phase 4 で詳細遷移になるため、再生導線を行内再生ボタン(`track.play`)に変更済み

ハマりどころ(iOS 26 シミュレータで確認):

- **LazyVStack 直下の兄弟 ForEach は ID 空間が平坦化される**: `ForEach(activeTasks)`(GenerationTask.id)と `ForEach(group.tracks)`(Track.id)がどちらも Int ID のため衝突し、ジョブカードのスロットに同 ID の楽曲行が誤描画された。ジョブカード+ヒーローを非 lazy の `VStack` 1 子に包んで分離して解決
- **`fixedSize` の子 + `frame(maxWidth: .infinity)` + `.clipped()` でははみ出しを切れない**: 子の理想幅が提案幅を超えると frame ごと子の幅まで広がり、クリップ境界も一緒に広がる。ピルは `SingleLinePillLayout`(Layout プロトコル。1 行に収まる分だけ配置し、収まらない子は画面外へ)で切り詰めた
- ヒーローカバー中央の細い横線は Suno 生成カバー画像自体の継ぎ目(元 JPEG に存在。レイアウト起因ではない)
- ジョブカードの検証: ローカルサーバーの DB に進行中タスク(TEXT_SUCCESS)を直接 INSERT した。ポーラーは API エラー時に FAILED にせず再試行するため、偽の provider_task_id でもタスクが進行中のまま残る

### Phase 4 実装メモ(2026-08-08)

`TrackDetailView` を新設し、行本体・ヒーローのタップで遷移するようにした。

- **構成**(モックの s-detail 準拠): 中央カバー 172pt/角丸 12 → タイトル → 日付+モード行 → AccentDeep アウトラインの再生/一時停止ピル+👍/👎(大)→ リアルワード → 狙い → スタイル → 歌詞 → メタ情報(生成日時・モード・インスト・Suno/LLM モデル)。LLM 導入前の旧データは nil のセクションを丸ごと出さない
- **リアルワード**: `WrappingPillLayout`(Layout プロトコル)で折り返して全件表示。冒険日はモード表記「おまかせ生成(冒険日)」で伝わるため詳細ではピルを出さない
- **スタイル**: styleJa を全文表示し、原文 style は「原文スタイルを表示」の折りたたみ。styleJa が無い旧データは原文を直接表示
- **歌詞**: English/日本語をアクセント下線のカスタムセグメントで切替(既定は日本語、片方しか無い曲はセグメント非表示)
- **遷移**: `NavigationStack(path: [Track])` + `navigationDestination(for: Track.self)`(`Track` を Hashable に)。行本体の Button は再生→詳細遷移に変更(再生は行内再生ボタン。Phase 3 で変更済みの UI テスト前提どおり)。ヒーローは全体に `onTapGesture` — 子の再生 Button のジェスチャが優先されるので共存できる
- ミニプレイヤーの `safeAreaInset` を NavigationStack 側へ移し、詳細画面でも表示されるようにした
- 👍/👎 を `RatingButtons` として共通化(行と詳細で使用。識別子接頭辞 `track`/`detail` と large を指定可)。評価結果は詳細のローカル state と一覧の tracks 配列の両方へ反映
- テスト: `TrackDetailUITests` 新設(行→詳細遷移・原文スタイル開閉・歌詞言語切替・ヒーロータップ遷移)。`ScreenshotUITests` に詳細画面 2 枚(上部・スクロール後)を追加。既存スモーク Playback/Rating も通過、ライト/ダークのスクショを目視確認
- iOS 26 ではスクロール中のコンテンツがフローティングの戻るボタンの背後を透けて通る(標準挙動。ナビバー背景には触らない方針のまま)

### Phase 5 実装メモ(2026-08-08)

- **PlayerService**: 再生キュー(ライブラリの表示順 = 新しい順。「次の曲」はリストの 1 つ下)を追加。`play(_:queue:)` は queue 指定で置換(ライブラリからの再生)、無指定は既存キューに track が居ればキュー維持(楽曲詳細・フルプレイヤーからの再生)、居なければその 1 曲だけに。曲終了(didPlayToEnd)で次の曲へ自動送り、キュー末尾は曲頭に戻して停止。`playPrevious` は 3 秒以上再生していれば曲頭へ(一般的なプレイヤーの挙動)
- **Now Playing**: `MPNowPlayingInfoCenter`(タイトル・アーティスト "Music Plant"・duration・elapsed・rate。カバーは CoverImageCache から取得後に同じ曲なら差し込み)+ `MPRemoteCommandCenter`(play/pause/toggle/next/prev/changePlaybackPosition、ハンドラは `MainActor.assumeIsolated`)。elapsed/rate は状態変化時のみ更新(システムが補間)
- **MiniPlayerView 刷新**: カバー 40pt+タイトル/styleJa+再生中イコライザ+再生/一時停止+次の曲。シークバーは廃止(フルプレイヤーへ)。本体タップで FullPlayerView をシート表示。onRated は TrackListView の applyRating を引き継ぐ
- **FullPlayerView 新設**: シート(ドラッグインジケータ表示・ナビバー非表示)。カバー 300pt/角丸 14/影 → タイトル → styleJa 1 行 → Slider(tint appAccent)+経過/-残り → 前後・再生/一時停止(44pt)→ 歌詞リンク+👍/👎。表示は常に `player.currentTrack` で自動送りに追従。歌詞は NavigationStack 内の PlayerLyricsView へ push(English/日本語セグメントは `LyricsSegment` に共通化して楽曲詳細と共用)
- **評価の一元化**: applyRating(一覧反映)から `PlayerService.applyRated`(currentTrack・キューへ反映)も呼ぶ。行・詳細・フルプレイヤーどこで評価しても両方へ届く

ハマりどころ:

- **`MPMediaItemArtwork` の requestHandler で実行時クラッシュ**: ハンドラは MediaPlayer がバックグラウンドキューから呼ぶが、@MainActor コンテキストで書いたクロージャは MainActor 分離と推論され `dispatch_assert_queue_fail`(EXC_BREAKPOINT)で落ちる → `{ @Sendable _ in image }` と明示して非分離にする
- `toolbarVisibility(_:for:)` は iOS 18+。iOS 17 ターゲットでは `toolbar(.hidden, for: .navigationBar)` を使う
- XCUITest のシート閉じは `app.swipeDown()` だとスライダー等に当たって閉じないことがある → 上端付近(dy 0.08)から座標ドラッグし、下の要素が hittable になるまで待つ
- 連続再生の自動テスト: フルプレイヤーのシークバーを `adjust(toNormalizedSliderPosition: 0.98)` で終端近くへ送り、曲終了 → タイトル変化を待つ方式で PlayerUITests に組み込めた(シミュレータ+ローカルサーバーなら安定)
- ロック画面・コントロールセンターの表示/操作は実機でのみ確認可能 → 次回 `./run-ios-device.sh` 時に確認する

### Phase 6 実装メモ(2026-08-08)

GenerateView を Form からライブラリと同じ ScrollView + VStack(横 22pt)構成に作り替えた。

- **おまかせ生成ヒーロー**: sparkles アイコン(AccentColor)+説明文+「いますぐ生成」ボタン(`Capsule` に `Color.accentDeep` 塗り+`Color.appBackground` 文字 — ダークでは accentDeep=アクセント・appBackground=暗色に解決されるのでモックのライト/ダーク仕様を 1 組の色で満たせる)。`POST /api/daily/run` はサーバー側でプロファイル更新→LLM 生成→Suno 送信まで待つため、BackendAPI に body 無し POST+timeout 上書き(180 秒)のオーバーロードを追加して使用。実行中はボタンを「曲を考えています…」+スピナーに
- **カスタム生成(折りたたみ)**: 行タップで開閉(chevron 回転)。TextField(枠線はヘアライン)+インストトグル+「生成する」文字ボタン(AccentDeep)。既存 `POST /api/generate` のまま
- **残クレジット**: `GET /api/credits` をナビバー右のピル(tint 背景+AccentDeep 文字)に表示。credits は null あり得るため Int? で、null 時はピル非表示(管理画面と同挙動)
- **進行状況**: 進行中(スピナー+ステータス+「モード · H:mm 開始」)/ 失敗 1 時間以内(赤)/ **今日完了(最大 5 件)** — チェックマーク(tint 円+AccentDeep)+曲名+「今日 H:mm 完了(· 冒険日)」+カバー 40pt。完了行の曲名・カバーは `/api/tracks` を taskId で引く(`GenerationTask` に title を追加)。ポーリングは 5 秒間隔でタスクのみ、完了検知時に tracks と credits を読み直す
- テスト: GenerateUITests 新設(おまかせ生成ボタンの表示・折りたたみ開閉・入力による送信ボタン有効化。**クレジット消費を避けるため生成ボタンはタップしない**)。ScreenshotUITests にカスタム展開状態を追加。進行中行はローカル DB へ TEXT_SUCCESS のタスクを直接 INSERT して目視確認(Phase 3 と同じ手法。確認後 DELETE)
- XCUITest の注意: SwiftUI の複数行 TextField(axis: .vertical)は textViews/textFields のどちらに出るか iOS 版で揺れる → `descendants(matching: .any)` で識別子検索する

### Phase 7 実装メモ(2026-08-08)

- **芝生イコライザのアニメーション化**: `EqualizerBars` に `animating` パラメータを追加。`TimelineView(.animation(minimumInterval: 1/30, paused: !animating))` で、バーごとに周期(rad/s)・位相をずらした sin 波で高さを揺らす(揺れの中心は静止レベルを中央寄りに圧縮した値でクリップを回避)。静止時は従来の固定レベル(アイコンの芝生シルエット)。使用箇所は再生中のみ表示される 2 箇所(一覧行 16pt・ミニプレイヤー 15pt)で、どちらも `animating: true` に
- **設定画面を他画面と同構成に統一**: Form → ScrollView + VStack(横 22pt)。セクション見出しは「進行状況」と同じ footnote bold secondary、URL/Secret フィールドはカスタム生成のプロンプト欄と同じヘアライン枠(`RoundedRectangle` + `Color(.separator)`)、接続テストは AccentDeep の文字ボタン+上にヘアライン区切り。機能・バインディングは変更なし。識別子 `settings.baseURL` / `settings.apiSecret` / `settings.test` を付与
- **見出しの `.rounded` は不採用**: 決定した案A のモックがシステム標準フォントで成立しており、実装も標準のままとする(デザイントークン表の「候補」の結論)
- 検証: シミュレータビルド+スモーク(Playback/Rating)+ScreenshotUITests をライト/ダークで実行し目視確認。アニメーションは一時 UI テストで再生中の画面を 0.4 秒間隔で 3 枚撮り、バーの高さが毎フレーム変わることを確認(一時テストは確認後削除)
- 設定画面の SecureField が空に見えるのは AppStorage に上書き値が無いため(Info.plist 注入の既定 secret はフィールドに表示しない従来からの挙動。認証は BackendAPI 側のフォールバックで効いている)

### Phase 8 実装メモ(2026-08-08)

サーバー設定の閲覧・編集を設定タブに追加した(Web 管理画面の設定ページと同項目・同じ「変更で即 PUT」の操作感)。

- **セクション構成**: 「毎日の自動生成」(自動生成トグル・実行時刻 0〜23 のメニュー Picker・タイムゾーン TextField・冒険日の確率 Slider)→「今日のコンテキスト」(ニュース/天気トグル・天気の都市のメニュー Picker)→ 既存の「サーバー接続」。読み込み完了までは「サーバー設定」プレースホルダ(スピナー、失敗時はエラー+再読み込みボタン。接続テスト成功時にも未読込なら取り直す)
- **保存方式**: トグル・Picker は変更を楽観反映して即 `PUT /api/settings`(部分更新)。応答のサーバー値で表示を上書きし、失敗時はエラー表示+再読込で現在値へ戻す。タイムゾーンは return 確定時・スライダーはドラッグ終了時に保存(編集途中の値はローカル state)。保存中はコントロールを disabled
- **都市**: 管理画面 settings.js と同じ 47 都道府県庁所在地の定数リスト(名前+座標)を Swift に持ち、選択時に weatherCity/Lat/Lon を 1 回の PUT で同時送信(名前と座標の不整合を防ぐ)。保存済みの都市名がリストに無い場合は「(現在の設定)」として選択肢の先頭に足す
- **モデル**: `ServerSettings`(iOS で扱う 7 項目のみ宣言 — 余分なキーはデコードで無視)+ `SettingsUpdateRequest`(全フィールド optional。synthesized Encodable は nil を省略するので部分更新になる)。`BackendAPI.putJSON` を追加
- **テスト**: SettingsUITests 新設 — ニューストグルを 2 回タップして往復させ、PUT 成功(失敗時は再読込で元に戻る実装のため、反転値が維持されれば成功)を検証。最終状態が元に戻るためローカルサーバーの設定は変化しない。ScreenshotUITests は設定タブの読み込み待ち+スクロール後の 1 枚を追加。curl で before/after の設定値が同一なことも確認
- 冒険日の確率スライダーは step 0.05(管理画面の入力 step と同じ)、表示は % 変換

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
