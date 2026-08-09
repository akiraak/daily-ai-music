import SwiftUI

/// アーティストの曲一覧(GET /api/artists/:id/songs)。曲をタップすると確認のうえ
/// POST /api/generate { artistSongId } で「その曲に似た新曲」を生成する。
/// 生成の進行状況は生成タブに出るため、開始したらこの画面は閉じて戻る
struct ArtistSongsView: View {
    let artist: Artist

    @Environment(\.dismiss) private var dismiss
    @State private var songs: [ArtistSong] = []
    @State private var keyword = ""
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var pendingSong: ArtistSong?
    @State private var isGenerating = false
    @FocusState private var keywordFocused: Bool

    private var filteredSongs: [ArtistSong] {
        let trimmed = keyword.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return songs }
        return songs.filter { $0.title.localizedCaseInsensitiveContains(trimmed) }
    }

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

                if isGenerating {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("AI がスタイルと歌詞を作っています…")
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

    private func songRow(_ song: ArtistSong) -> some View {
        Button {
            keywordFocused = false
            pendingSong = song
        } label: {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(song.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.primary)
                        .multilineTextAlignment(.leading)
                    if !song.subtitle.isEmpty {
                        Text(song.subtitle)
                            .font(.caption)
                            .foregroundStyle(Color.secondary)
                            .multilineTextAlignment(.leading)
                    }
                }
                Spacer(minLength: 8)
                Image(systemName: "sparkles")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Color.accentDeep)
            }
            .contentShape(Rectangle())
            .padding(.vertical, 13)
        }
        .buttonStyle(.plain)
        .disabled(isGenerating)
        .accessibilityIdentifier("artist.song")
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
            // サーバー側で LLM 生成 → Suno 送信まで待つため長め(おまかせ生成と同じ)
            _ = try await BackendAPI.postJSON(
                GenerateResponse.self,
                path: "/api/generate",
                body: GenerateRequest(prompt: "", instrumental: false, artistSongId: song.id),
                timeout: 180
            )
            // 進行状況は生成タブに出るので、開始したら一覧へ戻る
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
