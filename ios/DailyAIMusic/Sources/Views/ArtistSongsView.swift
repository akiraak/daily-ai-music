import SwiftUI

/// アーティストの曲一覧(GET /api/artists/:id/songs)。曲をタップすると確認のうえ
/// POST /api/generate { artistSongId } で「その曲に似た新曲」を生成する。
/// 生成の進行状況は生成タブに出るため、開始したらこの画面は閉じて戻る。
/// 行末のトグルは曲の有効/無効(PATCH /api/artist-songs/:id)。無効な曲は参照曲に選ばれず、
/// タップしても生成できない(Live / Remix 等は取り込み時に自動で無効になる)
struct ArtistSongsView: View {
    let artist: Artist

    /// 表示する曲の絞り込み(有効/無効は行を消さずに薄く出したいので既定は「すべて」)
    private enum Visibility: String, CaseIterable {
        case all, enabled
        var label: String { self == .all ? "すべて" : "有効のみ" }
    }

    @Environment(\.dismiss) private var dismiss
    @State private var songs: [ArtistSong] = []
    @State private var keyword = ""
    @State private var visibility: Visibility = .all
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var pendingSong: ArtistSong?
    @State private var isGenerating = false
    @FocusState private var keywordFocused: Bool

    private var filteredSongs: [ArtistSong] {
        let trimmed = keyword.trimmingCharacters(in: .whitespaces)
        return songs.filter { song in
            if visibility == .enabled && !song.isEnabled { return false }
            return trimmed.isEmpty || song.title.localizedCaseInsensitiveContains(trimmed)
        }
    }

    private var enabledCount: Int { songs.filter(\.isEnabled).count }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // 曲は最大 200 件になるため絞り込みを常設する(.searchable はこの画面構成では
                // 出ないことがあるので通常の入力欄にしている)
                TextField("曲名で絞り込み", text: $keyword)
                    .font(.subheadline)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .submitLabel(.done)
                    .focused($keywordFocused)
                    .padding(10)
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color(.separator)))
                    .padding(.top, 12)
                    .padding(.bottom, 4)
                    .accessibilityIdentifier("artist.songs.filter")

                Picker("表示", selection: $visibility) {
                    ForEach(Visibility.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.bottom, 6)
                .accessibilityIdentifier("artist.songs.visibility")

                if !isLoading && !songs.isEmpty {
                    Text("有効 \(enabledCount) / 全 \(songs.count) 曲 — トグルを入れた曲だけが参照曲になります")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.bottom, 4)
                }

                if isGenerating {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("生成を開始しています…")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 14)
                }
                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .padding(.top, 14)
                }
                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.top, 48)
                } else if songs.isEmpty {
                    Text("取り込まれた曲がありません。一覧のメニューから「曲を再取得」を試してください。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.top, 24)
                } else {
                    if enabledCount == 0 {
                        Text("有効な曲がありません。取り込んだ曲は無効の状態なので、参照曲にしたい曲のトグルを入れてください。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .padding(.vertical, 14)
                    }
                    ForEach(filteredSongs) { song in
                        Divider()
                        songRow(song)
                    }
                    Divider()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 22)
            .padding(.bottom, 24)
        }
        .background(Color.appBackground)
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle(artist.name)
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(
            pendingSong.map { "「\($0.title)」に似た曲を生成しますか?" } ?? "",
            isPresented: .init(get: { pendingSong != nil }, set: { if !$0 { pendingSong = nil } }),
            titleVisibility: .visible
        ) {
            Button("生成する") {
                if let song = pendingSong {
                    Task { await generate(song) }
                }
            }
            Button("キャンセル", role: .cancel) {}
        } message: {
            Text("原曲の歌詞は使わず、音楽的な特徴を参考に新しい曲をつくります。")
        }
        .task { await load() }
    }

    /// タイトル部(タップで生成)+ 右端に有効/無効のトグル。
    /// List を使わない画面構成のため swipeActions は効かず、行内トグルにしている
    private func songRow(_ song: ArtistSong) -> some View {
        HStack(spacing: 8) {
            Button {
                keywordFocused = false
                pendingSong = song
            } label: {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(song.title)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(song.isEnabled ? Color.primary : Color.secondary)
                            .multilineTextAlignment(.leading)
                        if !song.subtitle.isEmpty {
                            Text(song.subtitle)
                                .font(.caption)
                                .foregroundStyle(Color.secondary)
                                .multilineTextAlignment(.leading)
                        }
                    }
                    Spacer(minLength: 8)
                    // 無効な曲は生成できないので、生成の合図(sparkles)も出さない
                    if song.isEnabled {
                        Image(systemName: "sparkles")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Color.accentDeep)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isGenerating || !song.isEnabled)
            .accessibilityIdentifier("artist.song")

            Toggle("", isOn: enabledBinding(song))
                .labelsHidden()
                .tint(.accentDeep)
                .accessibilityLabel("「\(song.title)」を参照曲の候補にする")
                .accessibilityIdentifier("artist.song.toggle")
        }
        .padding(.vertical, 13)
    }

    /// トグルの束縛。set はそのまま PATCH に流す(楽観更新は setEnabled 側で行う)
    private func enabledBinding(_ song: ArtistSong) -> Binding<Bool> {
        Binding(
            get: { songs.first { $0.id == song.id }?.isEnabled ?? song.isEnabled },
            set: { newValue in Task { await setEnabled(song, newValue) } }
        )
    }

    /// 有効/無効の切り替え。押した瞬間に見た目を変え、失敗したら元に戻す
    private func setEnabled(_ song: ArtistSong, _ enabled: Bool) async {
        guard let index = songs.firstIndex(where: { $0.id == song.id }) else { return }
        let previous = songs[index].enabled
        songs[index].enabled = enabled
        do {
            _ = try await BackendAPI.patchJSON(
                ArtistSongResponse.self,
                path: "/api/artist-songs/\(song.id)",
                body: SetSongEnabledRequest(enabled: enabled)
            )
            errorMessage = nil
        } catch {
            // 再読み込みで並びが変わっていることがあるので id で引き直してから戻す
            if let current = songs.firstIndex(where: { $0.id == song.id }) {
                songs[current].enabled = previous
            }
            errorMessage = error.localizedDescription
        }
    }

    private func load() async {
        do {
            songs = try await BackendAPI.getJSON(
                ArtistSongsResponse.self, path: "/api/artists/\(artist.id)/songs"
            ).songs
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func generate(_ song: ArtistSong) async {
        isGenerating = true
        defer { isGenerating = false }
        do {
            // サーバーは受付だけ済ませてすぐ返す(LLM の生成はサーバー側で続く)ので待ち時間は短い
            _ = try await BackendAPI.postJSON(
                GenerateResponse.self,
                path: "/api/generate",
                body: GenerateRequest(prompt: "", instrumental: false, artistSongId: song.id)
            )
            // 進行状況は生成タブに出るので、開始したら一覧へ戻る
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
