import AVFoundation
import Foundation
import MediaPlayer
import UIKit

/// 楽曲のストリーミング再生(AVPlayer)。UIBackgroundModes: audio と合わせて
/// 画面ロック・バックグラウンドでも再生を継続する。
/// 再生キュー(ライブラリの表示順)を持ち、曲終了で次の曲へ自動送りする。
/// 再生順は queue のインデックス列 order で持ち、シャッフル時だけ並びが変わる。
/// ロック画面・コントロールセンターへは MPNowPlayingInfoCenter + MPRemoteCommandCenter で
/// 曲名・カバー・操作を出す
@MainActor
final class PlayerService: ObservableObject {
    static let shared = PlayerService()

    @Published private(set) var currentTrack: Track?
    @Published private(set) var isPlaying = false
    @Published private(set) var currentTime: Double = 0
    /// 再生キュー(ライブラリの表示順 = 新しい順)。表示順のまま保持し、並べ替えはしない
    @Published private(set) var queue: [Track] = []
    /// ランダム再生(シャッフル)。アプリを閉じても状態を保つ
    @Published private(set) var isShuffled: Bool = UserDefaults.standard.bool(
        forKey: AppSettingsKeys.shuffleEnabled
    )

    private let player = AVPlayer()
    /// 再生できなかったことを検知するための現在アイテムの status 監視(ErrorReporter へ送る + 復旧フラグ)
    private var statusObservation: NSKeyValueObservation?
    /// isPlaying を AVPlayer の実状態から導出するための監視。手動フラグだけだと
    /// システム側の停止(割り込み・ストール・アイテムの失敗)で表示が実態とずれる
    private var timeControlObservation: NSKeyValueObservation?
    /// 現在アイテムが再生不能で、次の再生操作で作り直しが要ることを示す。
    /// AVPlayerItem は一度 .failed になると play() では復活しない(AVFoundation の仕様)
    private var needsItemRecovery = false

    /// 再生順。queue のインデックス列で持つ(queue 自体は表示順のまま並べ替えない)。
    /// シャッフル OFF なら 0..<queue.count と同じで、ON なら現在曲を先頭にランダムに並ぶ
    private var order: [Int] = []

    private var currentIndex: Int? {
        guard let currentTrack else { return nil }
        return queue.firstIndex { $0.id == currentTrack.id }
    }

    /// 現在曲が再生順の何番目か。「次/前の曲」は queue ではなくこの位置の ±1 で決まる
    private var currentOrderPosition: Int? {
        guard let currentIndex else { return nil }
        return order.firstIndex(of: currentIndex)
    }

    var nextTrack: Track? {
        guard let position = currentOrderPosition, position + 1 < order.count else { return nil }
        return queue[order[position + 1]]
    }

    var previousTrack: Track? {
        guard let position = currentOrderPosition, position > 0 else { return nil }
        return queue[order[position - 1]]
    }

    private init() {
        // サイレントスイッチに関わらず音楽として再生するカテゴリ
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)

        player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.5, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            MainActor.assumeIsolated {
                self?.currentTime = time.seconds
            }
        }
        // isPlaying は AVPlayer の実状態(timeControlStatus)から導出する。
        // waiting はバッファ待ち = 再生しようとしている状態なので再生中扱いのまま
        timeControlObservation = player.observe(\.timeControlStatus, options: [.new]) { @Sendable [weak self] player, _ in
            let playing = player.timeControlStatus != .paused
            Task { @MainActor [weak self] in
                self?.syncIsPlaying(playing)
            }
        }
        NotificationCenter.default.addObserver(
            forName: AVPlayerItem.didPlayToEndTimeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.handleTrackEnded()
            }
        }
        // 再生途中で止まったケース(通信切れ・音源の破損)。開始時の失敗は status 監視で拾う
        NotificationCenter.default.addObserver(
            forName: AVPlayerItem.failedToPlayToEndTimeNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            // Notification は Sendable ではないので、クロージャの中で文字列にしてから渡す
            let error = note.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
            let description = error?.localizedDescription ?? "不明なエラー"
            MainActor.assumeIsolated {
                guard let self, let track = self.currentTrack else { return }
                self.needsItemRecovery = true
                ErrorReporter.shared.report(
                    source: "ios-player",
                    event: "playback_interrupted",
                    message: "「\(track.title)」の再生が中断: \(description)",
                    detail: [
                        "trackId": String(track.id),
                        "audioPath": track.audioUrl,
                        "error": description,
                    ]
                )
            }
        }
        // オーディオセッション割り込み(電話・アラーム・他アプリの音)。停止時の表示更新は
        // timeControlStatus の監視が拾うので、.ended + shouldResume の自動再開だけを扱う
        NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] note in
            // Notification は Sendable ではないので、値を取り出してから MainActor に入る
            let type = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt)
                .flatMap(AVAudioSession.InterruptionType.init(rawValue:))
            let options = AVAudioSession.InterruptionOptions(
                rawValue: note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            )
            MainActor.assumeIsolated {
                guard let self, type == .ended, options.contains(.shouldResume),
                      self.currentTrack != nil else { return }
                try? AVAudioSession.sharedInstance().setActive(true)
                self.player.play()
            }
        }
        // メディアサービスのリセット(稀)。既存の AVPlayerItem は全て無効になるので作り直す
        NotificationCenter.default.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.handleMediaServicesReset()
            }
        }
        configureRemoteCommands()
    }

    /// queue を渡すとキューを置き換える(ライブラリからの再生)。渡さない場合、
    /// 既存キューに track が居ればキューを保ち(楽曲詳細からの再生)、居なければその 1 曲だけにする。
    /// キューを入れ替えたときだけ再生順を組み直す(次へ・自動送りでは組み直さない)
    func play(_ track: Track, queue newQueue: [Track]? = nil) {
        if let newQueue {
            queue = newQueue
            rebuildOrder(startingAt: track)
        } else if !queue.contains(where: { $0.id == track.id }) {
            queue = [track]
            rebuildOrder(startingAt: track)
        }
        if currentTrack?.id != track.id {
            guard loadItem(for: track, resumeAt: 0) else { return }
            currentTrack = track
            currentTime = 0
            updateNowPlayingInfo(for: track)
        } else if needsCurrentItemRebuild {
            // 電波断などで壊れたアイテムは play() しても鳴らないため、作り直して同じ位置から再開する
            guard loadItem(for: track, resumeAt: currentTime) else { return }
        }
        try? AVAudioSession.sharedInstance().setActive(true)
        player.play()
        isPlaying = true
        updateNowPlayingPlaybackState()
    }

    /// 現在アイテムが再生不能で、作り直さないと再生できない状態か
    private var needsCurrentItemRebuild: Bool {
        needsItemRecovery || player.currentItem == nil || player.currentItem?.status == .failed
    }

    /// AVURLAsset からアイテムを作って差し替える。resumeAt > 0 ならその位置へシークする
    @discardableResult
    private func loadItem(for track: Track, resumeAt seconds: Double) -> Bool {
        guard let url = BackendAPI.absoluteURL(forServerPath: track.audioUrl) else { return false }
        // /api/audio/* は X-API-Secret 必須。AVPlayer は URLRequest を使えないため
        // AVURLAsset のオプションでヘッダを注入する
        let asset = AVURLAsset(url: url, options: [
            "AVURLAssetHTTPHeaderFieldsKey": BackendAPI.mediaRequestHeaders,
        ])
        let item = AVPlayerItem(asset: asset)
        observePlaybackFailure(of: item, track: track)
        player.replaceCurrentItem(with: item)
        needsItemRecovery = false
        if seconds > 0 {
            player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600))
            currentTime = seconds
        }
        return true
    }

    /// 再生開始に失敗した(音源が取れない・認証が通らない・壊れている)ことをサーバーへ報告する。
    /// KVO のコールバックは任意のスレッドから来るので、MainActor に触らない @Sendable クロージャにする
    private func observePlaybackFailure(of item: AVPlayerItem, track: Track) {
        statusObservation = item.observe(\.status, options: [.new]) { @Sendable [weak self] item, _ in
            guard item.status == .failed else { return }
            let message = item.error?.localizedDescription ?? "不明なエラー"
            Task { @MainActor [weak self] in
                self?.needsItemRecovery = true
            }
            ErrorReporter.shared.report(
                source: "ios-player",
                event: "playback_failed",
                message: "「\(track.title)」の再生に失敗: \(message)",
                detail: [
                    "trackId": String(track.id),
                    "audioPath": track.audioUrl,
                    "error": message,
                ]
            )
        }
    }

    func togglePlayPause() {
        guard let track = currentTrack else { return }
        if isPlaying {
            player.pause()
            isPlaying = false
            updateNowPlayingPlaybackState()
        } else if needsCurrentItemRebuild {
            // 壊れたアイテムのまま play() しても鳴らない。作り直しと位置復元は play(_:) に任せる
            play(track)
        } else {
            player.play()
            isPlaying = true
            updateNowPlayingPlaybackState()
        }
    }

    /// timeControlStatus の変化を isPlaying へ反映する(正はこちら。
    /// play/pause 内の手動代入はタップへ即座に表示を返すためのもの)
    private func syncIsPlaying(_ playing: Bool) {
        guard isPlaying != playing else { return }
        isPlaying = playing
        updateNowPlayingPlaybackState()
    }

    func seek(to seconds: Double) {
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600))
        currentTime = seconds
        updateNowPlayingPlaybackState()
    }

    func playNext() {
        if let nextTrack { play(nextTrack) }
    }

    /// 3 秒以上再生していれば曲頭へ、直後なら前の曲へ(一般的な音楽プレイヤーの挙動)
    func playPrevious() {
        if currentTime > 3 {
            seek(to: 0)
        } else if let previousTrack {
            play(previousTrack)
        } else {
            seek(to: 0)
        }
    }

    /// 曲終了: 次の曲があれば自動送り、キュー末尾なら曲頭に戻して停止
    private func handleTrackEnded() {
        if let nextTrack {
            play(nextTrack)
        } else {
            isPlaying = false
            currentTime = 0
            player.seek(to: .zero)
            updateNowPlayingPlaybackState()
        }
    }

    /// メディアサービスのリセット。セッション設定は失われ、既存の AVPlayerItem は使えなくなるので、
    /// カテゴリを設定し直して現在アイテムを同じ位置で作り直す(再生の自動再開はしない)
    private func handleMediaServicesReset() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        needsItemRecovery = true
        guard let track = currentTrack else { return }
        loadItem(for: track, resumeAt: currentTime)
    }

    // MARK: - ランダム再生

    /// シャッフルの ON/OFF。ON にすると現在の曲を先頭に残りをランダムに並べ替え、
    /// OFF に戻すとキューの表示順へ戻る(現在の曲は表示順での位置に戻るので、
    /// 「次の曲」は表示順の 1 つ下になる)
    func toggleShuffle() {
        isShuffled.toggle()
        UserDefaults.standard.set(isShuffled, forKey: AppSettingsKeys.shuffleEnabled)
        rebuildOrder(startingAt: currentTrack)
    }

    private func rebuildOrder(startingAt track: Track?) {
        var generator = SystemRandomNumberGenerator()
        let head = track.flatMap { target in queue.firstIndex { $0.id == target.id } }
        order = Self.playbackOrder(
            count: queue.count, head: head, shuffled: isShuffled, using: &generator
        )
    }

    /// 再生順(queue のインデックス列)を作る純関数。シャッフル時は head を先頭に固定して
    /// 残りをランダムに並べる — 一度作った順序は次へ・前へで辿り直すだけなので、
    /// ON のあいだ同じ曲は二度来ず、一巡したら末尾で止まる。
    /// テストで分布を確かめられるよう乱数を注入できるようにしてある
    static func playbackOrder<G: RandomNumberGenerator>(
        count: Int, head: Int?, shuffled: Bool, using generator: inout G
    ) -> [Int] {
        let all = Array(0..<count)
        guard shuffled else { return all }
        guard let head, all.indices.contains(head) else { return all.shuffled(using: &generator) }
        return [head] + all.filter { $0 != head }.shuffled(using: &generator)
    }

    // MARK: - ロック画面・コントロールセンター

    private func configureRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.currentTrack != nil else { return .commandFailed }
                if !self.isPlaying { self.togglePlayPause() }
                return .success
            }
        }
        center.pauseCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.currentTrack != nil else { return .commandFailed }
                if self.isPlaying { self.togglePlayPause() }
                return .success
            }
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.currentTrack != nil else { return .commandFailed }
                self.togglePlayPause()
                return .success
            }
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.nextTrack != nil else { return .noSuchContent }
                self.playNext()
                return .success
            }
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.currentTrack != nil else { return .commandFailed }
                self.playPrevious()
                return .success
            }
        }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            MainActor.assumeIsolated {
                guard let self, self.currentTrack != nil,
                      let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
                self.seek(to: event.positionTime)
                return .success
            }
        }
    }

    private func updateNowPlayingInfo(for track: Track) {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: track.title,
            MPMediaItemPropertyArtist: "Music Plant",
            MPMediaItemPropertyPlaybackDuration: track.duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: 0.0,
            MPNowPlayingInfoPropertyPlaybackRate: 1.0,
        ]
        // カバーは取得でき次第、まだ同じ曲を再生していれば差し込む
        Task { [weak self] in
            guard let image = await CoverImageCache.shared.image(forServerPath: track.imageUrl),
                  let self, self.currentTrack?.id == track.id else { return }
            var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
            // クロージャは MediaPlayer がバックグラウンドキューから呼ぶため
            // @Sendable で MainActor 分離の推論を外す(分離ありだと実行時クラッシュ)
            info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { @Sendable _ in image }
            MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        }
    }

    /// 再生状態・位置の変化を Now Playing へ反映する(システムは rate と elapsed から現在位置を補間する)
    private func updateNowPlayingPlaybackState() {
        guard var info = MPNowPlayingInfoCenter.default().nowPlayingInfo else { return }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentTime
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? 1.0 : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}
