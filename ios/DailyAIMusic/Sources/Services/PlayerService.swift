import AVFoundation
import Foundation

/// 楽曲のストリーミング再生(AVPlayer)。UIBackgroundModes: audio と合わせて
/// 画面ロック・バックグラウンドでも再生を継続する
@MainActor
final class PlayerService: ObservableObject {
    static let shared = PlayerService()

    @Published private(set) var currentTrack: Track?
    @Published private(set) var isPlaying = false
    @Published private(set) var currentTime: Double = 0

    private let player = AVPlayer()

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
                guard let self else { return }
                self.isPlaying = false
                self.currentTime = 0
                self.player.seek(to: .zero)
            }
        }
    }

    func play(_ track: Track) {
        guard let url = BackendAPI.absoluteURL(forServerPath: track.audioUrl) else { return }
        if currentTrack?.id != track.id {
            player.replaceCurrentItem(with: AVPlayerItem(url: url))
            currentTrack = track
            currentTime = 0
        }
        try? AVAudioSession.sharedInstance().setActive(true)
        player.play()
        isPlaying = true
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
    }

    func seek(to seconds: Double) {
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600))
        currentTime = seconds
    }
}
