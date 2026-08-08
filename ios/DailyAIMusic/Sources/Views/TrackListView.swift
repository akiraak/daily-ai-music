import SwiftUI

/// ライブラリ(ホーム)。進行中ジョブカード・今日の一曲ヒーロー・日付グループのリストを縦に並べる。
/// レイアウトは案A ミニマル(docs/plans/ios-app-design-mocks/01-minimal.html)基準
struct TrackListView: View {
    @ObservedObject private var player = PlayerService.shared
    @State private var tracks: [Track] = []
    @State private var activeTasks: [GenerationTask] = []
    @State private var errorMessage: String?
    @State private var isLoading = false

    var body: some View {
        NavigationStack {
            Group {
                if let errorMessage, tracks.isEmpty {
                    ContentUnavailableView {
                        Label("読み込みエラー", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("再読み込み") { Task { await load() } }
                    }
                } else if tracks.isEmpty && activeTasks.isEmpty && !isLoading {
                    ContentUnavailableView(
                        "楽曲がまだありません",
                        systemImage: "music.note",
                        description: Text("生成タブから曲を作れます")
                    )
                } else {
                    libraryList
                }
            }
            .background(Color.appBackground)
            .navigationTitle("ライブラリ")
            .refreshable { await load() }
            .task { await pollWhileVisible() }
            .safeAreaInset(edge: .bottom) {
                if player.currentTrack != nil {
                    MiniPlayerView()
                }
            }
        }
    }

    private var libraryList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                // ジョブカード+ヒーローは非 lazy の VStack で 1 子にまとめる。
                // LazyVStack 直下の兄弟 ForEach は ID 空間が平坦化され、
                // GenerationTask.id と Track.id(どちらも Int)が衝突して誤描画するため
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(activeTasks) { task in
                        GenerationJobCard(task: task)
                        Divider()
                    }

                    if let hero = todayTrack {
                        heroHeader(for: hero)
                        HeroCard(
                            track: hero,
                            isPlayingThis: player.currentTrack?.id == hero.id && player.isPlaying,
                            onPlay: { playOrToggle(hero) }
                        )
                    }
                }

                ForEach(dayGroups) { group in
                    Text(group.label)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.secondary)
                        .padding(.top, 14)
                        .padding(.bottom, 2)
                    ForEach(group.tracks) { track in
                        TrackRow(
                            track: track,
                            isCurrent: player.currentTrack?.id == track.id,
                            isPlaying: player.isPlaying,
                            onPlay: { playOrToggle(track) },
                            onRated: { updated in
                                if let index = tracks.firstIndex(where: { $0.id == updated.id }) {
                                    tracks[index] = updated
                                }
                            }
                        )
                        Divider()
                    }
                }
            }
            .padding(.horizontal, 22)
            .padding(.bottom, 24)
        }
    }

    private func playOrToggle(_ track: Track) {
        if player.currentTrack?.id == track.id {
            player.togglePlayPause()
        } else {
            player.play(track)
        }
    }

    // MARK: - 今日の一曲・日付グループ

    /// 当日生成の最新曲(tracks は新しい順)。無い日はヒーローを出さない
    private var todayTrack: Track? {
        tracks.first { Calendar.current.isDateInToday($0.createdAt) }
    }

    private func heroHeader(for track: Track) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text("今日の一曲")
                .font(.footnote.weight(.bold))
            Spacer()
            Text(Self.dayFormatter.string(from: track.createdAt))
                .font(.caption2.weight(.semibold))
        }
        .foregroundStyle(.secondary)
        .padding(.top, 12)
        .padding(.bottom, 8)
    }

    private struct TrackDayGroup: Identifiable {
        let id: Date
        let label: String
        var tracks: [Track]
    }

    /// 生成日(端末タイムゾーン)でグループ化。tracks が新しい順なので隣接をまとめるだけでよい
    private var dayGroups: [TrackDayGroup] {
        let calendar = Calendar.current
        var groups: [TrackDayGroup] = []
        for track in tracks {
            let day = calendar.startOfDay(for: track.createdAt)
            if groups.last?.id == day {
                groups[groups.count - 1].tracks.append(track)
            } else {
                groups.append(TrackDayGroup(id: day, label: dayLabel(day), tracks: [track]))
            }
        }
        return groups
    }

    private func dayLabel(_ day: Date) -> String {
        if Calendar.current.isDateInToday(day) { return "今日" }
        if Calendar.current.isDateInYesterday(day) { return "昨日" }
        return Self.dayFormatter.string(from: day)
    }

    /// アプリの表示言語は日本語固定のため、端末ロケールに依らず日本語表記にする
    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "M月d日(E)"
        return formatter
    }()

    // MARK: - 読み込み・ポーリング

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        await loadTracks()
        await refreshTasks(reloadTracksOnFinish: false)
    }

    private func loadTracks() async {
        do {
            tracks = try await BackendAPI.getJSON(TracksResponse.self, path: "/api/tracks").tracks
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// タブ表示中のみ 5 秒間隔で生成ジョブを監視する(.task がタブ離脱時にキャンセルする)
    private func pollWhileVisible() async {
        await load()
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(5))
            await refreshTasks()
        }
    }

    /// 進行中ジョブを更新する。ジョブが完了したら楽曲一覧も読み直して新しい曲を反映する
    private func refreshTasks(reloadTracksOnFinish: Bool = true) async {
        guard let fetched = try? await BackendAPI.getJSON(TasksResponse.self, path: "/api/tasks").tasks else {
            // ポーリングの失敗は画面を壊さない(初回読み込みのエラーは loadTracks が表示する)
            return
        }
        let newActive = fetched.filter(\.isActive)
        let finishedSome = activeTasks.contains { old in !newActive.contains { $0.id == old.id } }
        activeTasks = newActive
        if reloadTracksOnFinish && finishedSome {
            await loadTracks()
        }
    }
}

// MARK: - 進行中ジョブカード

/// 生成中タスクの進行状況(スピナー・ステータス・経過時間・段階ベースの進行バー)
private struct GenerationJobCard: View {
    let task: GenerationTask

    var body: some View {
        HStack(spacing: 12) {
            ProgressView()
            VStack(alignment: .leading, spacing: 2) {
                Text("生成中 · \(task.modeLabel)")
                    .font(.footnote.weight(.semibold))
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text("\(task.statusLabel) · \(elapsedText(at: context.date))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color(.separator).opacity(0.5))
                        Capsule().fill(Color.appAccent)
                            .frame(width: geometry.size.width * task.progressFraction)
                    }
                }
                .frame(height: 4)
                .padding(.top, 5)
            }
        }
        .padding(.vertical, 11)
        .accessibilityIdentifier("library.job")
    }

    private func elapsedText(at now: Date) -> String {
        formatDuration(max(0, now.timeIntervalSince(task.createdAt)))
    }
}

// MARK: - 今日の一曲ヒーロー

private struct HeroCard: View {
    let track: Track
    let isPlayingThis: Bool
    let onPlay: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CoverImageView(path: track.imageUrl)
                .frame(maxWidth: .infinity)
                .frame(height: 190)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay(alignment: .bottomTrailing) {
                    Button(action: onPlay) {
                        Image(systemName: isPlayingThis ? "pause.fill" : "play.fill")
                            .font(.system(size: 19))
                            .foregroundStyle(Color.accentDeep)
                            .frame(width: 44, height: 44)
                            .background(Color.appBackground.opacity(0.92), in: Circle())
                    }
                    .buttonStyle(.borderless)
                    .padding(12)
                    .accessibilityIdentifier("hero.play")
                }

            Text(track.title)
                .font(.title3.weight(.heavy))
                .lineLimit(2)
                .padding(.top, 11)

            if let styleJa = track.styleJa {
                Text(styleJa)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .padding(.top, 2)
            }

            let words = track.realWorldWords
            if track.isAdventure || !words.isEmpty {
                SingleLinePillLayout(spacing: 6) {
                    if track.isAdventure {
                        PillTag(text: "冒険日", emphasized: true)
                    }
                    ForEach(Array(words.prefix(4).enumerated()), id: \.offset) { _, word in
                        PillTag(text: word)
                    }
                    if words.count > 4 {
                        PillTag(text: "+\(words.count - 4)")
                    }
                }
                .padding(.top, 8)
            }
        }
        .padding(.bottom, 14)
    }
}

// MARK: - リスト行

/// 一覧の 1 行。行本体のタップと右上の再生ボタンで再生/一時停止、👍/👎 は独立したトグルボタン
/// (管理画面と同じ仕様)。Phase 4 で行本体タップは詳細画面への遷移に変える予定
private struct TrackRow: View {
    let track: Track
    let isCurrent: Bool
    let isPlaying: Bool
    let onPlay: () -> Void
    let onRated: (Track) -> Void

    @State private var isRating = false

    var body: some View {
        HStack(spacing: 10) {
            Button(action: onPlay) {
                HStack(spacing: 12) {
                    CoverImageView(path: track.imageUrl)
                        .frame(width: 52, height: 52)
                        .clipShape(RoundedRectangle(cornerRadius: 7))

                    VStack(alignment: .leading, spacing: 2) {
                        Text(track.title)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(isCurrent ? Color.accentDeep : Color.primary)
                            .lineLimit(1)
                        Text(track.styleJa ?? track.modeLabel)
                            .font(.caption)
                            .foregroundStyle(Color.secondary)
                            .lineLimit(1)
                        pillsRow
                    }

                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("track.row")

            VStack(spacing: 4) {
                playButton
                HStack(spacing: 7) {
                    ratingButton(value: 1, symbol: "hand.thumbsup", identifier: "track.rate.up")
                    ratingButton(value: -1, symbol: "hand.thumbsdown", identifier: "track.rate.down")
                }
            }
        }
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private var pillsRow: some View {
        let words = track.realWorldWords
        if track.isAdventure || !words.isEmpty {
            SingleLinePillLayout(spacing: 5) {
                if track.isAdventure {
                    PillTag(text: "冒険日", emphasized: true)
                }
                ForEach(Array(words.prefix(3).enumerated()), id: \.offset) { _, word in
                    PillTag(text: word)
                }
            }
            .padding(.top, 3)
        }
    }

    private var playButton: some View {
        Button(action: onPlay) {
            Group {
                if isCurrent && isPlaying {
                    EqualizerBars(height: 16)
                } else {
                    Image(systemName: "play.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(Color.accentDeep)
                }
            }
            .frame(width: 33, height: 33)
        }
        .buttonStyle(.borderless)
        .accessibilityIdentifier("track.play")
    }

    private func ratingButton(value: Int, symbol: String, identifier: String) -> some View {
        let isActive = track.rating == value
        return Button {
            Task { await rate(value) }
        } label: {
            Image(systemName: isActive ? "\(symbol).fill" : symbol)
                .font(.footnote)
                // Color.secondary 固定(階層 .secondary はボタン内でティント由来の色になるため)
                .foregroundStyle(isActive ? AnyShapeStyle(.tint) : AnyShapeStyle(Color.secondary))
                .frame(width: 26, height: 28)
        }
        .buttonStyle(.borderless)
        .disabled(isRating)
        .accessibilityIdentifier(identifier)
        .accessibilityValue(isActive ? "on" : "off")
    }

    private func rate(_ value: Int) async {
        isRating = true
        defer { isRating = false }
        do {
            let request = RatingRequest(rating: track.rating == value ? nil : value)
            let response = try await BackendAPI.postJSON(
                RatingResponse.self,
                path: "/api/tracks/\(track.id)/rating",
                body: request
            )
            onRated(response.track)
        } catch {
            // 通信・HTTP エラーは BackendAPI がログ済み。表示は変えず次のタップで再試行できる
        }
    }
}

func formatDuration(_ seconds: Double) -> String {
    let s = Int(seconds.rounded())
    return String(format: "%d:%02d", s / 60, s % 60)
}
