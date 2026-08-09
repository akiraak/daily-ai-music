import SwiftUI

/// 生成パラメータ画面。おまかせ生成(毎日の自動生成)が LLM に注入する入力
/// (設定値・要素プールと評価集計・直近スタイル・リアルワード制限)を一望する読み取り専用画面。
/// 編集はさせない(プリセットは管理画面、設定は設定タブの役割)。
/// レイアウトは案A ミニマル基準(ScrollView + VStack 横 22pt・ヘアライン区切り)
struct GenerationParamsView: View {
    @State private var params: GenerationParams?
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if let params {
                    settingsSection(params)
                    poolSection(params)
                    stylesSection(params)
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
        paramRow("冒険日確率", "\(Int((p.adventureProbability * 100).rounded())) %", identifier: "params.adventure")
        Divider()
        paramRow("今日のコンテキスト", contextValue(p))
        Divider()
        paramRow("リアルワード制限", "直近 \(p.wordWindowDays) 日で同一ワード \(p.wordMaxUses) 回まで")
    }

    private func contextValue(_ p: GenerationParams) -> String {
        let news = "ニュース \(p.contextNews ? "ON" : "OFF")"
        let weather = p.contextWeather ? "天気 ON(\(p.weatherCity))" : "天気 OFF"
        return "\(news) · \(weather)"
    }

    // MARK: - 要素プール

    @ViewBuilder
    private func poolSection(_ p: GenerationParams) -> some View {
        if !p.presets.isEmpty {
            sectionHeader("要素プール(\(p.presets.count) 要素)")
            Text("LLM はこのプールから評価集計(👍/👎)を踏まえて要素を選ぶ。冒険日は集計に従わず、普段選ばれない要素にも挑戦する。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.bottom, 4)
            ForEach(categories(p), id: \.self) { category in
                subHeader(p.categoryLabels[category] ?? category)
                WrappingPillLayout(spacing: 6) {
                    ForEach(p.presets.filter { $0.category == category }) { preset in
                        PillTag(text: pillText(preset))
                    }
                }
            }
        }
    }

    /// カテゴリの並びはサーバーの返却順(要素プールの提示順と同じ)を保つ
    private func categories(_ p: GenerationParams) -> [String] {
        var seen = Set<String>()
        return p.presets.compactMap { seen.insert($0.category).inserted ? $0.category : nil }
    }

    /// 評価があるものだけ集計を添える(LLM への提示 = presetLines の suffix と同じ規則)
    private func pillText(_ preset: PoolPreset) -> String {
        guard preset.upCount > 0 || preset.downCount > 0 else { return preset.labelJa }
        return "\(preset.labelJa) 👍\(preset.upCount)/👎\(preset.downCount)"
    }

    // MARK: - 直近の生成スタイル

    @ViewBuilder
    private func stylesSection(_ p: GenerationParams) -> some View {
        if !p.recentStyles.isEmpty {
            sectionHeader("直近の生成スタイル")
            Text("重複を避けるため、直近の曲のスタイルがプロンプトに注入される。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.bottom, 2)
            ForEach(Array(p.recentStyles.enumerated()), id: \.offset) { index, style in
                if index > 0 { Divider() }
                VStack(alignment: .leading, spacing: 3) {
                    Text(style.styleJa ?? style.style)
                        .font(.footnote)
                        .lineSpacing(2)
                    if style.styleJa != nil {
                        // 実際に注入されるのは英語 style のため原文も添える
                        Text(style.style)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
                .padding(.vertical, 8)
            }
        }
    }

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
