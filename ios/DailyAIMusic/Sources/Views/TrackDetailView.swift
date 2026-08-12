import SwiftUI

/// 楽曲詳細。API が返す未活用データ(リファレンス・リアルワード・狙い・スタイル・歌詞と訳)を見せる画面。
/// レイアウトは案A ミニマル(docs/plans/ios-app-design-mocks/01-minimal.html)基準。
/// LLM 導入前の旧データはメタデータが nil のため、該当セクションは出さない
struct TrackDetailView: View {
    @ObservedObject private var player = PlayerService.shared
    private let track: Track

    @State private var showsOriginalStyle = false
    @State private var showsPrompt = false
    @State private var showsJapaneseLyrics: Bool
    /// 公開ページへの表示(楽観更新するためローカルに持つ。Track は値渡しのスナップショット)
    @State private var isPublished: Bool
    @State private var isUpdatingPublished = false
    @State private var publishError: String?

    init(track: Track) {
        self.track = track
        _showsJapaneseLyrics = State(initialValue: track.lyricsJa != nil)
        _isPublished = State(initialValue: track.isPublished)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                publishSection
                referenceSection
                wordsSection
                intentSection
                sourcesSection
                styleSection
                lyricsSection
                promptSection
                metaFooter
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 22)
            .padding(.bottom, 24)
        }
        .background(Color.appBackground)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: - ヘッダー(カバー・タイトル・再生・評価)

    private var isCurrent: Bool { player.currentTrack?.id == track.id }
    private var isPlayingThis: Bool { isCurrent && player.isPlaying }

    private var header: some View {
        VStack(spacing: 0) {
            CoverImageView(path: track.imageUrl)
                .frame(width: 172, height: 172)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.top, 4)

            Text(track.title)
                .font(.title3.weight(.heavy))
                .multilineTextAlignment(.center)
                .padding(.top, 14)

            Text("\(Self.dayFormatter.string(from: track.createdAt)) · \(track.modeLabel)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.top, 3)

            playButton
                .padding(.top, 14)
        }
        .frame(maxWidth: .infinity)
    }

    /// 案A ミニマルの主要ボタン仕様: AccentDeep アウトラインのピル
    private var playButton: some View {
        Button {
            if isCurrent {
                player.togglePlayPause()
            } else {
                player.play(track)
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: isPlayingThis ? "pause.fill" : "play.fill")
                    .font(.system(size: 14))
                Text(isPlayingThis ? "一時停止" : "再生")
                    .font(.subheadline.weight(.bold))
            }
            .foregroundStyle(Color.accentDeep)
            .padding(.horizontal, 26)
            .padding(.vertical, 9)
            .overlay(Capsule().strokeBorder(Color.accentDeep, lineWidth: 1.5))
        }
        .buttonStyle(.borderless)
        .accessibilityIdentifier("detail.play")
    }

    // MARK: - セクション

    /// 公開ページ(誰でも見られる Web)への表示。opt-out 運用なので「聴いてまずい」と
    /// 思ったらここで即座に下げられるようにする(下げると一覧・音源・カバーとも見えなくなる)
    @ViewBuilder
    private var publishSection: some View {
        Toggle(isOn: publishedBinding) {
            Text("公開ページに表示")
                .font(.footnote.weight(.semibold))
        }
        .tint(.accentDeep)
        .disabled(isUpdatingPublished)
        .padding(.top, 22)
        .accessibilityIdentifier("detail.publish")

        if let publishError {
            Text(publishError)
                .font(.caption2)
                .foregroundStyle(.red)
                .padding(.top, 4)
        }
    }

    /// トグルの束縛。set はそのまま PATCH に流す(楽観更新は setPublished 側で行う)
    private var publishedBinding: Binding<Bool> {
        Binding(
            get: { isPublished },
            set: { newValue in Task { await setPublished(newValue) } }
        )
    }

    /// 公開/非公開の切り替え。押した瞬間に見た目を変え、失敗したら元に戻す
    private func setPublished(_ published: Bool) async {
        let previous = isPublished
        isPublished = published
        isUpdatingPublished = true
        defer { isUpdatingPublished = false }
        do {
            _ = try await BackendAPI.patchJSON(
                TrackResponse.self,
                path: "/api/tracks/\(track.id)",
                body: SetTrackPublishedRequest(published: published)
            )
            publishError = nil
        } catch {
            isPublished = previous
            publishError = error.localizedDescription
        }
    }

    /// アーティスト経由生成で参照した曲(使用時点のスナップショット。
    /// アーティストを削除しても残る)。他モード・旧データでは出さない
    @ViewBuilder
    private var referenceSection: some View {
        if let reference = track.referenceLabel {
            sectionHeader("リファレンス")
            bodyText(reference)
        }
    }

    @ViewBuilder
    private var wordsSection: some View {
        if !track.realWorldWords.isEmpty {
            sectionHeader("リアルワード")
            WrappingPillLayout(spacing: 6) {
                ForEach(Array(track.realWorldWords.enumerated()), id: \.offset) { _, word in
                    PillTag(text: word)
                }
            }
        }
    }

    @ViewBuilder
    private var intentSection: some View {
        if let intent = track.intent {
            sectionHeader("狙い")
            bodyText(intent)
        }
    }

    /// web_search で参照した情報源。参照曲ありの生成でだけ入る(他モード・旧サーバーでは空)
    @ViewBuilder
    private var sourcesSection: some View {
        if let sources = track.sources, !sources.isEmpty {
            sectionHeader("参照した情報源")
            bodyText(sources.joined(separator: "\n"))
        }
    }

    @ViewBuilder
    private var styleSection: some View {
        if track.styleJa != nil || track.style != nil {
            sectionHeader("スタイル")
            if let styleJa = track.styleJa {
                bodyText(styleJa)
                if track.style != nil {
                    originalStyleDisclosure
                }
            } else if let style = track.style {
                // styleJa が無い旧データは原文をそのまま見せる
                bodyText(style)
            }
        }
    }

    @ViewBuilder
    private var originalStyleDisclosure: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) { showsOriginalStyle.toggle() }
        } label: {
            HStack(spacing: 3) {
                Text(showsOriginalStyle ? "原文スタイルを隠す" : "原文スタイルを表示")
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .bold))
                    .rotationEffect(.degrees(showsOriginalStyle ? 180 : 0))
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(Color.accentDeep)
        }
        .buttonStyle(.plain)
        .padding(.top, 7)
        .accessibilityIdentifier("detail.style.original")

        if showsOriginalStyle, let style = track.style {
            Text(style)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineSpacing(3)
                .padding(.top, 7)
        }
    }

    @ViewBuilder
    private var lyricsSection: some View {
        if track.lyrics != nil || track.lyricsJa != nil {
            HStack(alignment: .firstTextBaseline) {
                sectionHeader("歌詞")
                Spacer()
                if track.lyrics != nil && track.lyricsJa != nil {
                    LyricsSegment(showsJapanese: $showsJapaneseLyrics)
                }
            }
            if let lyrics = showsJapaneseLyrics ? track.lyricsJa : track.lyrics {
                Text(lyrics)
                    .font(.footnote)
                    .lineSpacing(4)
            }
        }
    }

    /// 生成に使った LLM への入力全文。折りたたみ(既定は閉)で、原文スタイルと同じ開閉パターン。
    /// llmPrompt が無い旧データ・旧サーバーではセクションごと出さない
    @ViewBuilder
    private var promptSection: some View {
        if let llmPrompt = track.llmPrompt {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { showsPrompt.toggle() }
            } label: {
                HStack(spacing: 3) {
                    Text(showsPrompt ? "生成プロンプトを隠す" : "生成プロンプトを表示")
                    Image(systemName: "chevron.down")
                        .font(.system(size: 9, weight: .bold))
                        .rotationEffect(.degrees(showsPrompt ? 180 : 0))
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.accentDeep)
            }
            .buttonStyle(.plain)
            .padding(.top, 18)
            .accessibilityIdentifier("detail.prompt")

            if showsPrompt {
                promptBody(llmPrompt)
            }
        }
    }

    @ViewBuilder
    private func promptBody(_ llmPrompt: String) -> some View {
        if let sections = Self.promptSections(llmPrompt) {
            ForEach(Array(sections.enumerated()), id: \.offset) { _, section in
                Text(section.title)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
                    .padding(.top, 12)
                Text(section.body)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineSpacing(3)
                    .padding(.top, 4)
            }
        } else {
            // 「## 」見出しの無い旧データは全文をそのまま見せる
            Text(llmPrompt)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineSpacing(3)
                .padding(.top, 12)
        }
    }

    private struct PromptSection {
        let title: String
        let body: String
    }

    /// llmPrompt(buildSongPlanPrompt の出力)を行頭「## 」を境にセクション分解する。
    /// 見出しが無い・見出し前に本文がある場合は nil(全文表示にフォールバック)。
    /// 分解ルールは Web 管理画面(app.js の splitPromptSections)と同じ
    private static func promptSections(_ text: String) -> [PromptSection]? {
        var sections: [(title: String, body: [String])] = []
        for line in text.components(separatedBy: "\n") {
            if line.hasPrefix("## ") {
                sections.append((String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces), []))
            } else if sections.isEmpty {
                if !line.trimmingCharacters(in: .whitespaces).isEmpty { return nil }
            } else {
                sections[sections.count - 1].body.append(line)
            }
        }
        if sections.isEmpty { return nil }
        return sections.map {
            PromptSection(
                title: $0.title,
                body: $0.body.joined(separator: "\n")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            )
        }
    }

    private var metaFooter: some View {
        Text(metaLine)
            .font(.caption2)
            .foregroundStyle(.secondary)
            .padding(.top, 22)
    }

    private var metaLine: String {
        var parts = ["\(Self.metaDateFormatter.string(from: track.createdAt)) 生成", track.modeLabel]
        if track.instrumental { parts.append("インスト") }
        // 歌声の言語(記録の無い旧データでは出ない。インストは歌わないので出さない)
        if !track.instrumental, let vocalLanguage = track.vocalLanguageLabel {
            parts.append("\(vocalLanguage)歌唱")
        }
        if let sunoModel = track.sunoModel { parts.append(sunoModel) }
        if let llmModel = track.llmModel { parts.append(llmModel) }
        return parts.joined(separator: " · ")
    }

    // MARK: - 共通パーツ

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.caption.weight(.bold))
            .foregroundStyle(.secondary)
            .padding(.top, 18)
            .padding(.bottom, 7)
    }

    private func bodyText(_ text: String) -> some View {
        Text(text)
            .font(.footnote)
            .lineSpacing(3)
    }

    /// アプリの表示言語は日本語固定のため、端末ロケールに依らず日本語表記にする(一覧と同方針)
    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "y年M月d日(E)"
        return formatter
    }()

    private static let metaDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "y-MM-dd HH:mm"
        return formatter
    }()
}
