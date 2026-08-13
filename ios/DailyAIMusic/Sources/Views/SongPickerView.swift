import SwiftUI

/// 曲から生成(GET /api/reference-songs)。有効な参照曲をアーティスト横断で並べ、
/// 1 曲選ぶと確認のうえ POST /api/generate { artistSongId } で「その曲に似た新曲」を生成する。
/// 生成の進行状況は生成タブに出るため、開始したらこの画面は閉じて戻る。
/// 登録済みにない曲は「登録済みにない曲を探す」から曲名検索(SongSearchView)へ。
/// レイアウトは案A ミニマル基準(ScrollView + VStack 横 22pt・ヘアライン区切り)
struct SongPickerView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var songs: [ReferenceSong] = []
    @State private var keyword = ""
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var pendingSong: ReferenceSong?
    @State private var isGenerating = false
    @FocusState private var keywordFocused: Bool

    private var filteredSongs: [ReferenceSong] {
        let trimmed = keyword.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return songs }
        return songs.filter {
            $0.title.localizedCaseInsensitiveContains(trimmed)
                || $0.artistName.localizedCaseInsensitiveContains(trimmed)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                TextField("曲名・アーティスト名で絞り込み", text: $keyword)
                    .font(.subheadline)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .submitLabel(.done)
                    .focused($keywordFocused)
                    .padding(10)
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color(.separator)))
                    .padding(.top, 12)
                    .accessibilityIdentifier("songPicker.filter")

                if !isLoading {
                    Text("有効な参照曲 \(songs.count) 曲から選べます。選んだ曲の音楽的な特徴に似た新曲をつくります(原曲の歌詞は使いません)。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.top, 8)
                        .padding(.bottom, 4)
                }

                // 参照曲にまだ無い曲は、曲名検索(登録 → 生成の一気通貫)へ
                NavigationLink {
                    SongSearchView()
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "plus")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color.accentDeep)
                        VStack(alignment: .leading, spacing: 1) {
                            Text("登録済みにない曲を探す")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.primary)
                            Text("曲名で iTunes を検索して参照曲に追加")
                                .font(.caption)
                                .foregroundStyle(Color.secondary)
                        }
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Color.secondary)
                    }
                    .contentShape(Rectangle())
                    .padding(.vertical, 13)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("songPicker.search")

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
                        .padding(.vertical, 10)
                }
                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.top, 48)
                } else if songs.isEmpty && errorMessage == nil {
                    Text("有効な参照曲がありません。参照曲の画面で曲を登録して有効にするか、上の曲名検索から追加してください。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.top, 14)
                } else {
                    ForEach(filteredSongs) { song in
                        Divider()
                        songRow(song)
                    }
                    if !filteredSongs.isEmpty { Divider() }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 22)
            .padding(.bottom, 24)
        }
        .background(Color.appBackground)
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("曲から生成")
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

    private func songRow(_ song: ReferenceSong) -> some View {
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
                    Text(song.subtitle)
                        .font(.caption)
                        .foregroundStyle(Color.secondary)
                        .multilineTextAlignment(.leading)
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
        .accessibilityIdentifier("songPicker.row")
    }

    private func load() async {
        do {
            songs = try await BackendAPI.getJSON(ReferenceSongsResponse.self, path: "/api/reference-songs").songs
            errorMessage = nil
        } catch {
            // 旧サーバー(エンドポイント未実装)や接続断でも画面内のエラー表示に留める
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func generate(_ song: ReferenceSong) async {
        isGenerating = true
        defer { isGenerating = false }
        do {
            // サーバーは受付だけ済ませてすぐ返す(LLM の生成はサーバー側で続く)ので待ち時間は短い
            _ = try await BackendAPI.postJSON(
                GenerateResponse.self,
                path: "/api/generate",
                body: GenerateRequest(prompt: "", instrumental: false, artistSongId: song.id)
            )
            // 進行状況は生成タブに出るので、開始したら戻る
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
