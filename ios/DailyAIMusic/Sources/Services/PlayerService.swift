import AVFoundation
import Foundation
import MediaPlayer
import UIKit

/// 楽曲のストリーミング再生(AVPlayer)。UIBackgroundModes: audio と合わせて
/// 画面ロック・バックグラウンドでも再生を継続する。
/// 再生キュー(ライブラリの表示順)を持ち、曲終了で次の曲へ自動送りする。
/// ロック画面・コントロールセンターへは MPNowPlayingInfoCenter + MPRemoteCommandCenter で
/// 曲名・カバー・操作を出す
@MainActor
final class PlayerService: ObservableObject {
    static let shared = PlayerService()

    @Published private(set) var currentTrack: Track?
    @Published private(set) var isPlaying = false
    @Published private(set) var currentTime: Double = 0
    /// 再生キュー(ライブラリの表示順 = 新しい順)。「次の曲」はリストの 1 つ下
    @Published private(set) var queue: [Track] = []

    private let player = AVPlayer()

    private var currentIndex: Int? {
        guard let currentTrack else { return nil }
        return queue.firstIndex { $0.id == currentTrack.id }
    }

    var nextTrack: Track? {
        guard let index = currentIndex, index + 1 < queue.count else { return nil }
        return queue[index + 1]
    }

    var previousTrack: Track? {
        guard let index = currentIndex, index > 0 else { return nil }
        return queue[index - 1]
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
        NotificationCenter.default.addObserver(
            forName: AVPlayerItem.didPlayToEndTimeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.handleTrackEnded()
            }
        }
        configureRemoteCommands()
    }

    /// queue を渡すとキューを置き換える(ライブラリからの再生)。渡さない場合、
    /// 既存キューに track が居ればキューを保ち(楽曲詳細からの再生)、居なければその 1 曲だけにする
    func play(_ track: Track, queue newQueue: [Track]? = nil) {
        if let newQueue {
            queue = newQueue
        } else if !queue.contains(where: { $0.id == track.id }) {
            queue = [track]
        }
        guard let url = BackendAPI.absoluteURL(forServerPath: track.audioUrl) else { return }
        if currentTrack?.id != track.id {
            // /api/audio/* は X-API-Secret 必須。AVPlayer は URLRequest を使えないため
            // AVURLAsset のオプションでヘッダを注入する
            let asset = AVURLAsset(url: url, options: [
                "AVURLAssetHTTPHeaderFieldsKey": BackendAPI.mediaRequestHeaders,
            ])
            player.replaceCurrentItem(with: AVPlayerItem(asset: asset))
            currentTrack = track
            currentTime = 0
            updateNowPlayingInfo(for: track)
        }
        try? AVAudioSession.sharedInstance().setActive(true)
        player.play()
        isPlaying = true
        updateNowPlayingPlaybackState()
    }

    func togglePlayPause() {
        guard currentTrack != nil else { return }
        if isPlaying {
            player.pause()
            isPlaying = false
        } else {
            player.play()
            isPlaying = true
        }
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
