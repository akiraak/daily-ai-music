import SwiftUI

/// 登録済みにない曲を曲名で探して生成する(「曲を選んで生成」= SongPickerView から push)。
/// 曲を選ぶと iTunes の応答からアーティストを逆引きして登録(POST /api/artist-songs)し、
/// そのまま POST /api/generate { artistSongId } まで進む(登録 → 生成の一気通貫)。
/// カバー・ピアノ版・オルゴールが多く混ざるため、必ず候補から選ばせて取り違えを防ぐ。
/// レイアウトは案A ミニマル基準(ScrollView + VStack 横 22pt・ヘアライン区切り)
struct SongSearchView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var term = ""
    @State private var candidates: [SongCandidate] = []
    @State private var isSearching = false
    /// 登録 → 生成の進行中に出す文言(nil なら進行中でない)
    @State private var progressText: String?
    @State private var message: String?
    @State private var isError = false
    @State private var pendingCandidate: SongCandidate?
    @FocusState private var termFocused: Bool

    private var isBusy: Bool { isSearching || progressText != nil }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    TextField("曲名(例: Lemon / 夜に駆ける)", text: $term)
                        .font(.subheadline)
                        .autocorrectionDisabled()
                        .focused($termFocused)
                        .submitLabel(.search)
                        .onSubmit { Task { await search() } }
                        .padding(10)
                        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color(.separator)))
                        .accessibilityIdentifier("song.search.term")
                    Button("検索") { Task { await search() } }
                        .font(.subheadline.weight(.bold))
                        .tint(.accentDeep)
                        .disabled(term.trimmingCharacters(in: .whitespaces).isEmpty || isBusy)
                        .accessibilityIdentifier("song.search.submit")
                }
                .padding(.top, 12)

                Text("アーティスト名を足すと精度が上がります(例: 米津玄師 Lemon)。カバーやピアノ版も混ざるので、アーティスト名を見て選んでください。")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.top, 8)

                if let progressText {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text(progressText)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.top, 14)
                } else if isSearching {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.top, 20)
                }
                if let message {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(isError ? .red : .secondary)
                        .padding(.top, 14)
                }

                ForEach(candidates) { candidate in
                    Divider()
                    candidateRow(candidate)
                }
                if !candidates.isEmpty { Divider() }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 22)
            .padding(.bottom, 24)
        }
        .background(Color.appBackground)
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("曲名から探す")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(
            pendingCandidate.map { "「\($0.title)」に似た曲を生成しますか?" } ?? "",
            isPresented: .init(get: { pendingCandidate != nil }, set: { if !$0 { pendingCandidate = nil } }),
            titleVisibility: .visible
        ) {
            Button("生成する") {
                if let candidate = pendingCandidate {
                    Task { await registerAndGenerate(candidate) }
                }
            }
            Button("キャンセル", role: .cancel) {}
        } message: {
            Text("この曲とアーティストを登録してから、原曲の歌詞は使わずに音楽的な特徴を参考にした新曲をつくります。")
        }
        .onAppear { termFocused = true }
    }

    private func candidateRow(_ candidate: SongCandidate) -> some View {
        Button {
            termFocused = false
            pendingCandidate = candidate
        } label: {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(candidate.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.primary)
                        .multilineTextAlignment(.leading)
                    Text(candidate.subtitle)
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
        .disabled(isBusy)
        .accessibilityIdentifier("song.candidate")
    }

    private func search() async {
        let keyword = term.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !keyword.isEmpty else { return }
        termFocused = false
        isSearching = true
        defer { isSearching = false }
        candidates = []
        message = nil
        do {
            let encoded = keyword.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? keyword
            candidates = try await BackendAPI.getJSON(
                SongSearchResponse.self, path: "/api/artist-songs/search?term=\(encoded)"
            ).candidates
            message = candidates.isEmpty
                ? "「\(keyword)」に一致する曲が見つかりません。"
                : "生成のもとにする曲を選んでください。"
            isError = false
        } catch {
            message = error.localizedDescription
            isError = true
        }
    }

    /// 登録(アーティストの逆引き込み)と生成を続けて行う。登録が済めばアーティスト画面にも
    /// 残るため、生成だけ失敗しても曲一覧からやり直せる
    private func registerAndGenerate(_ candidate: SongCandidate) async {
        message = nil
        progressText = "曲を登録しています…(iTunes から曲を取り込みます)"
        defer { progressText = nil }
        let registered: CreateArtistSongResponse
        do {
            // 未登録アーティストは最大 200 曲を取り込むためサーバー側の処理がやや長い
            registered = try await BackendAPI.postJSON(
                CreateArtistSongResponse.self,
                path: "/api/artist-songs",
                body: CreateArtistSongRequest(itunesTrackId: candidate.itunesTrackId),
                timeout: 60
            )
        } catch {
            message = error.localizedDescription
            isError = true
            return
        }

        progressText = "生成を開始しています…"
        do {
            // サーバーは受付だけ済ませてすぐ返す(LLM の生成はサーバー側で続く)ので待ち時間は短い
            _ = try await BackendAPI.postJSON(
                GenerateResponse.self,
                path: "/api/generate",
                body: GenerateRequest(prompt: "", instrumental: false, artistSongId: registered.song.id)
            )
            // 進行状況は生成タブに出るので、開始したら戻る
            dismiss()
        } catch {
            // 登録は済んでいるので、アーティスト画面の曲一覧から生成し直せることを伝える
            message = "\(error.localizedDescription)(「\(registered.artist.name)」の「\(registered.song.title)」は登録済みです)"
            isError = true
        }
    }
}
