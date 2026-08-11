import SwiftUI

/// 生成パラメータ画面。おまかせ生成(毎日の自動生成)が LLM に注入する入力を一望する読み取り専用画面。
/// 設定値・参照曲の候補・リアルワード制限を出す。編集はさせない(設定は設定タブの役割)。
/// レイアウトは案A ミニマル基準(ScrollView + VStack 横 22pt・ヘアライン区切り)
struct GenerationParamsView: View {
    @State private var params: GenerationParams?
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if let params {
                    settingsSection(params)
                    referenceSection(params)
                    wordsSection(params)
                } else if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .padding(.top, 24)
                } else {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.top, 48)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 22)
            .padding(.bottom, 24)
        }
        .background(Color.appBackground)
        .navigationTitle("生成パラメータ")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    // MARK: - 生成の設定

    @ViewBuilder
    private func settingsSection(_ p: GenerationParams) -> some View {
        sectionHeader("生成の設定")
        paramRow("今日のコンテキスト", contextValue(p), identifier: "params.context")
        Divider()
        paramRow("リアルワード制限", "直近 \(p.wordWindowDays) 日で同一ワード \(p.wordMaxUses) 回まで")
    }

    private func contextValue(_ p: GenerationParams) -> String {
        "ニュース \(p.contextNews ? "ON" : "OFF")"
    }

    // MARK: - 参照曲の候補

    @ViewBuilder
    private func referenceSection(_ p: GenerationParams) -> some View {
        let candidates = p.referenceCandidates
        sectionHeader("参照曲の候補(\(candidates.count) アーティスト・\(candidates.reduce(0) { $0 + $1.songCount }) 曲)")
        if candidates.isEmpty {
            // 候補が無いと参照曲を選べず、おまかせ生成はサーバー側で 409 になる
            Text("アーティストが登録されていないため、おまかせ生成はできません。「アーティストから生成」または「曲名から生成」で登録してください。")
                .font(.caption)
                .foregroundStyle(.secondary)
        } else {
            Text("登録した曲から 1 曲を選び、その曲の BPM・キー・編成を web 検索で調べてから作曲する。アーティストを一巡するように、最後に使ってから最も時間が経った人・曲から選ばれる。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.bottom, 4)
        }
        ForEach(Array(candidates.enumerated()), id: \.element.id) { index, candidate in
            if index > 0 { Divider() }
            paramRow(candidate.artistName, "\(candidate.songCount) 曲 · \(lastUsedText(candidate.lastUsedAt))")
        }

        let recent = p.recentReferences
        if !recent.isEmpty {
            subHeader("直近に参照した曲")
            ForEach(Array(recent.enumerated()), id: \.offset) { index, reference in
                if index > 0 { Divider() }
                paramRow("\(reference.artistName)「\(reference.title)」", Self.dayFormatter.string(from: reference.usedAt))
            }
        }
    }

    /// 未使用のものが先に選ばれるため、日付より「未使用」であること自体が重要な情報
    private func lastUsedText(_ date: Date?) -> String {
        guard let date else { return "未使用" }
        return "\(Self.dayFormatter.string(from: date)) 使用"
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "M/d"
        return formatter
    }()

    // MARK: - リアルワードの使用状況

    @ViewBuilder
    private func wordsSection(_ p: GenerationParams) -> some View {
        sectionHeader("リアルワードの使用状況")
        if p.bannedWords.isEmpty && p.lastChanceWords.isEmpty {
            Text("現在、制限中のワードはありません。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        if !p.bannedWords.isEmpty {
            subHeader("使用禁止(上限到達)")
            WrappingPillLayout(spacing: 6) {
                ForEach(p.bannedWords, id: \.self) { word in
                    PillTag(text: word, emphasized: true)
                }
            }
        }
        if !p.lastChanceWords.isEmpty {
            subHeader("残り 1 回")
            WrappingPillLayout(spacing: 6) {
                ForEach(p.lastChanceWords, id: \.self) { word in
                    PillTag(text: word)
                }
            }
        }
        Text("直近 \(p.wordWindowDays) 日で \(p.trackedWordCount) ワードを追跡中")
            .font(.caption2)
            .foregroundStyle(.secondary)
            .padding(.top, 12)
    }

    // MARK: - 共通パーツ

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.footnote.weight(.bold))
            .foregroundStyle(.secondary)
            .padding(.top, 18)
            .padding(.bottom, 6)
    }

    private func subHeader(_ title: String) -> some View {
        Text(title)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.top, 10)
            .padding(.bottom, 5)
    }

    /// identifier は UI テストが読み込み完了を待つための目印(値の Text に付ける)
    private func paramRow(_ title: String, _ value: String, identifier: String? = nil) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(title)
                .font(.subheadline)
            Spacer(minLength: 12)
            Text(value)
                .font(.subheadline.weight(.semibold))
                .multilineTextAlignment(.trailing)
                .accessibilityIdentifier(identifier ?? "")
        }
        .padding(.vertical, 10)
    }

    private func load() async {
        do {
            params = try await BackendAPI.getJSON(
                GenerationParamsResponse.self, path: "/api/generation-params"
            ).params
            errorMessage = nil
        } catch {
            // 旧サーバー(エンドポイント未実装)や接続断でも画面内のエラー表示に留める
            if params == nil { errorMessage = error.localizedDescription }
        }
    }
}
