# iOS 再生の復帰不全を直す(表示が実態とずれる・電波断後に再生できない)

## 目的・背景

再生まわりで 2 つの症状が出ている(2026-08-26 報告)。

1. **iPhone の画面を消してアプリに戻ると「再生中」表示のまま** — 実際には音が止まっているのに、
   UI(ミニプレイヤー・フルプレイヤー・ロック画面)は再生中のまま
2. **電波が一度途切れて復活しても再生ができない** — どこを押しても再生が始まらない

本番ログにも裏付けがある — `.logs/prod-20260826-1900/errors.jsonl` に
`playback_failed`「The Internet connection appears to be offline.」(track 80)。
エラー報告(`ErrorReporter`)は機能しているが、**報告するだけで復旧経路が無い**。

### 原因(コードから特定済み)

いずれも `PlayerService.swift`。

1. **`isPlaying` が手動管理のフラグで、AVPlayer の実状態と同期していない** —
   `play()` / `togglePlayPause()` が自分で立て下げするだけで、システム側の停止
   (割り込み・ストール・アイテムの失敗)では誰も下げない → 症状 1 の表示ずれ。
2. **`AVPlayerItem` は一度 `.failed` になると復活しない**(AVFoundation の仕様。
   `play()` を呼んでも何も起きない)。現状 `observePlaybackFailure()` と
   `failedToPlayToEndTimeNotification` は ErrorReporter への報告のみで、
   アイテムを作り直す経路が無い。さらに `play(_:)` は同じ曲の再再生では
   `currentTrack?.id != track.id` ガードによりアイテムを作り直さないため、
   失敗後は同じ曲をタップしても壊れたアイテムに `play()` するだけ → 症状 2。
3. **オーディオセッション割り込み(電話・アラーム・他アプリの音)を扱っていない** —
   `AVAudioSession.interruptionNotification` の購読が無く、割り込み終了後も
   止まったまま + UI は再生中表示(症状 1 の一因)。

症状 1 と 2 は同根のことが多い: 電波断でアイテムが `.failed` → 音が止まる →
フラグは立ったままなので画面復帰時に「再生中」に見える(症状 1)→
タップしても壊れたアイテムのままなので再生できない(症状 2)。

## 対応方針

### 1. `isPlaying` を AVPlayer の実状態から導出する(症状 1)

`player.timeControlStatus` を KVO で監視し、`isPlaying` はそこから更新する
(`.playing` / `.waitingToPlayAtSpecifiedRate` = true、`.paused` = false。
waiting はバッファ待ちで「再生しようとしている」状態なので再生中扱いのまま)。
これでシステムがどんな理由で止めても UI とロック画面(`updateNowPlayingPlaybackState()`)が追従する。
`play()` / `togglePlayPause()` の手動代入は「意図の表明」として残してよいが、正はKVO側。

### 2. 失敗したアイテムを再生操作で作り直す(症状 2)

- 失敗の検知(`status == .failed` の KVO・`failedToPlayToEndTimeNotification`)で
  `needsItemRecovery` を立てる(ErrorReporter への報告は今のまま残す)
- 次の再生操作(`togglePlayPause()` の再生側・同じ曲への `play(_:)`)で
  `needsItemRecovery` または現在アイテムが `.failed` なら、**AVURLAsset から
  アイテムを作り直して `currentTime` へシークしてから再生**する
  (`currentTime` は周期オブザーバの最終値が失敗時点の位置として残っている)
- **自動再開はしない**(NWPathMonitor での回線監視はやらない)。
  「電波が戻ったらユーザーが再生を押すと続きから鳴る」まで。
  勝手に鳴り出すのは驚きになるし、実装も監視分だけ複雑になる

### 3. オーディオセッション割り込みへの対応

`AVAudioSession.interruptionNotification` を購読し、
`.ended` + `.shouldResume` のときだけ自動再開する(電話を切ったら続きが鳴る、
という OS 標準の作法)。`.began` の表示更新は 1. の KVO が拾うので何もしない。
あわせて `mediaServicesWereResetNotification`(稀)では現在アイテムを作り直す。

## 影響範囲

- `ios/DailyAIMusic/Sources/Services/PlayerService.swift` のみ。
  View 側(`MiniPlayerView` / `FullPlayerView`)は `@Published isPlaying` を
  見ているだけなので変更不要。サーバー・API・DB は変更なし

## テスト方針

ネットワーク断・画面ロック・割り込みはシミュレータの XCUITest では再現できないため、
**実機の手動確認を正**とし、UI テストは回帰(既存スイートが通ること)に使う。

1. シミュレータビルド + 既存 UI テスト(PlayerUITests / PlaybackUITests)で回帰なし
2. 実機(`./run-ios-device.sh`、本番接続):
   - 再生中に機内モード ON → 音が止まり、UI が一時停止表示になる(症状 1 の解消)
   - 機内モード OFF → 再生タップで**続きの位置から**再開する(症状 2 の解消)
   - 画面ロック → 復帰で表示が実態と一致している
   - タイマー/アラームを鳴らす → 止まったあと、閉じると自動再開する(shouldResume)
3. 失敗時に `playback_failed` / `playback_interrupted` が引き続きサーバーへ報告されること
   (復旧を入れても観測は殺さない)

## Phase

- Phase 1: `isPlaying` を `timeControlStatus` の KVO から導出 + ロック画面の同期(症状 1)
- Phase 2: 失敗アイテムの検知フラグ + 再生操作での作り直しと位置復元(症状 2)
- Phase 3: 割り込み(interruption / mediaServicesReset)対応 + 実機での通し確認
