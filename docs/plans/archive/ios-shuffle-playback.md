# iOS プレイヤーにランダム再生(シャッフル)を入れる

## 目的・背景

iOS の再生キューは**ライブラリの表示順(新しい順)に固定**されている。`PlayerService` は
`queue: [Track]` を持ち、`nextTrack` / `previousTrack` は現在曲の配列インデックス ±1 で決まる
(`ios/DailyAIMusic/Sources/Services/PlayerService.swift:30-38`)。そのため

- 何度聴いても常に「新しい順」で、古い曲は末尾に埋もれたまま聴かれない
- 毎日 3 曲ずつ増えるライブラリなのに、聴く順序に多様性が無い

再生順をシャッフルできるようにする。**サーバー側の変更は無い**(再生順はクライアントの都合で、
API にも DB にも順序の概念を持たせない)。

なお「ランダム」という語はこのリポジトリでは**生成側**(`server/src/reference.ts` の参照曲 LRU 選択)で
既に使われている。今回のものは再生順の話で、生成とは無関係。

## 対応方針

### 再生順は「queue のインデックス列」で持つ

`queue` は**表示順のまま変えない**(ライブラリの並びと 1:1 で、UI 側の期待を壊さないため)。
別に再生順 `order: [Int]`(queue へのインデックス列)を持ち、次/前は **order 上の位置**の ±1 で決める。

- シャッフル OFF: `order = Array(queue.indices)` = 現状と完全に同じ挙動
- シャッフル ON: `order = [現在曲] + 残りをシャッフル`

配列そのものをシャッフルしない理由: `queue` を並べ替えると「ライブラリの表示順」という意味が失われ、
シャッフル解除時に元の順へ戻せない。インデックス列なら解除は `Array(queue.indices)` を作り直すだけで、
**現在曲は表示順での位置に自然に戻る**(= 解除直後の「次の曲」は表示順の次)。

### 順序を組む部分は純関数にする

乱数を注入できる `static func playbackOrder(count:head:shuffled:using:)` として切り出し、
分布(どの曲も等確率で来るか・現在曲が先頭に固定されるか・重複や欠落が無いか)を
スクリプトで確認できるようにする(`server/src/reference.ts` と同じ考え方)。

### 順序を組み直すタイミング

| きっかけ | 挙動 |
|---|---|
| シャッフルの ON/OFF | 現在曲を先頭(ON)/表示順(OFF)にして組み直す |
| キューの差し替え(`play(_:queue:)` にキューを渡す = ライブラリからの再生) | タップした曲を先頭にして組み直す |
| 自動送り・次へ・前へ | **組み直さない**(一度決めた順序を辿る。前へで戻れる) |

「一度決めた順序を辿る」ため、ON のあいだは同じ曲が二度来ない・一巡したら止まる(現状の末尾挙動と同じ)。
リピートは今回入れない。

### 状態は UserDefaults に持つ

`AppSettingsKeys.shuffleEnabled`。音楽プレイヤーとして毎回 OFF に戻るのは煩わしく、
また**入口が「フルプレイヤーのトグル」だけ**なので、一度 ON にすれば以降ライブラリのどの曲を
タップしてもその曲から先がシャッフルになる、という形にしておきたい。

### UI

フルプレイヤー(`FullPlayerView`)の**歌詞リンクと同じ行**にトグルを置く。

- 前/再生/次の 3 ボタンの行には足さない — 4 つ目を入れると再生ボタンが中央からずれる
  (実測: 横 padding 28 + ボタン 44/70/44 + 間隔 46 で iPhone 17 の幅ぎりぎり)
- ON は `Color.accentDeep`、OFF は `Color.secondary`(案A ミニマルに合わせ、色と太さだけで状態を出す)
- アクセシビリティ ID は既存の再生/一時停止ボタンに倣って**状態で切り替える**
  (`player.shuffle.on` / `player.shuffle.off`)

ミニプレイヤーには足さない(幅が無い・フルプレイヤーで足りる)。

## 影響範囲

- `ios/DailyAIMusic/Sources/Services/PlayerService.swift` — `order` / `isShuffled` / `toggleShuffle()` 追加、
  `nextTrack` / `previousTrack` / `play(_:queue:)` を order 経由に変更
- `ios/DailyAIMusic/Sources/Support/AppSettingsKeys.swift` — キー追加
- `ios/DailyAIMusic/Sources/Views/FullPlayerView.swift` — トグル追加(歌詞リンクと同じ行)
- `ios/DailyAIMusicUITests/PlayerUITests.swift` — シャッフルのスモークテスト追加
- サーバー・API・DB・管理画面・公開ページ: **変更なし**

## テスト方針

1. `playbackOrder` の純関数チェック(乱数を注入して分布・先頭固定・重複/欠落なし・OFF の同一性)
2. シミュレータビルド
3. XCUITest(`PlayerUITests`): トグルで状態が変わる / ON でも次へ送れる / シートを閉じて開いても状態が残る
4. 既存の再生系テスト(`PlaybackUITests` / `PlayerUITests` の自動送り)が OFF のとき従来どおり通ること
5. ライト/ダークのスクリーンショット目視

## Phase

- Phase 1: `PlayerService` の再生順を order 経由にする(挙動は変えない = シャッフル OFF 相当)+ 純関数チェック
- Phase 2: シャッフルの状態・トグル・永続化を足す
- Phase 3: `FullPlayerView` の UI + UI テスト + 目視確認
