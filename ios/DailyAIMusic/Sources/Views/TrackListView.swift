import SwiftUI

/// ライブラリ(ホーム)。進行中ジョブカード・今日の一曲ヒーロー・日付グループのリストを縦に並べる。
/// レイアウトは案A ミニマル(docs/plans/ios-app-design-mocks/01-minimal.html)基準
struct TrackListView: View {
    @ObservedObject private var player = PlayerService.shared
    @State private var tracks: [Track] = []
    @State private var activeTasks: [GenerationTask] = []
    @State private var errorMessage: String?
    @State private var isLoading = false
    @State private var path: [Track] = []

    var body: some View {
        NavigationStack(path: $path) {
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
            .navigationDestination(for: Track.self) { track in
                TrackDetailView(track: track)
            }
            .refreshable { await load() }
            .task { await pollWhileVisible() }
        }
        // NavigationStack 側に付けて、詳細画面へ遷移してもミニプレイヤーが残るようにする
        .safeAreaInset(edge: .bottom) {
            if player.currentTrack != nil {
                MiniPlayerView()
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
                            onPlay: { playOrToggle(hero) },
                            onOpen: { path.append(hero) }
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
                            onOpen: { path.append(track) }
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
            // ライブラリからの再生は一覧の表示順を再生キューにする(曲終了で次の曲へ自動送り)
            player.play(track, queue: tracks)
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

/// タップ(再生ボタン以外)で楽曲詳細へ。再生ボタンは子 Button のジェスチャが優先されるので
/// 全体の onTapGesture と共存できる
private struct HeroCard: View {
    let track: Track
    let isPlayingThis: Bool
    let onPlay: () -> Void
    let onOpen: () -> Void

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

            ReferenceLine(track: track)
                .padding(.top, 2)

            let words = track.realWorldWords
            if !words.isEmpty {
                SingleLinePillLayout(spacing: 6) {
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
        .contentShape(Rectangle())
        .onTapGesture(perform: onOpen)
        .accessibilityIdentifier("hero.card")
    }
}

// MARK: - 生成元(リファレンス)

/// その曲を作るときに参照した曲(使用時点のスナップショット)を 1 行で出す。
/// 楽曲詳細の「リファレンス」セクションと同じ文言で、一覧では折り返さず省略する。
/// 参照曲を持たない旧データでは何も出さない
private struct ReferenceLine: View {
    let track: Track

    var body: some View {
        if let reference = track.referenceLabel {
            Text("リファレンス: \(reference)")
                .font(.caption2)
                .foregroundStyle(Color.secondary)
                .lineLimit(1)
        }
    }
}

// MARK: - リスト行

/// 一覧の 1 行。行本体のタップで楽曲詳細へ、再生/一時停止は行内の再生ボタン
private struct TrackRow: View {
    let track: Track
    let isCurrent: Bool
    let isPlaying: Bool
    let onPlay: () -> Void
    let onOpen: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Button(action: onOpen) {
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
                        ReferenceLine(track: track)
                        pillsRow
                    }

                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("track.row")

            playButton
        }
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private var pillsRow: some View {
        let words = track.realWorldWords
        if !words.isEmpty {
            SingleLinePillLayout(spacing: 5) {
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
                    EqualizerBars(height: 16, animating: true)
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
}

func formatDuration(_ seconds: Double) -> String {
    let s = Int(seconds.rounded())
    return String(format: "%d:%02d", s / 60, s % 60)
}
