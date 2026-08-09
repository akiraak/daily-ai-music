import SwiftUI

/// 設定タブ。サーバー設定(毎日の自動生成・今日のコンテキスト = GET/PUT /api/settings)と
/// サーバー接続(URL・Secret・接続テスト)。サーバー設定は保存ボタンを置かず、
/// トグル・入力の変更で即 PUT する(Web 管理画面と同じ操作感)。
/// レイアウトは案A ミニマル基準(ScrollView + VStack 横 22pt・ヘアライン区切り)
struct SettingsView: View {
    @AppStorage(AppSettingsKeys.backendBaseURL) private var baseURL = AppSettingsKeys.defaultBackendBaseURL
    @AppStorage(AppSettingsKeys.apiSecret) private var apiSecret = AppSettingsKeys.defaultAPISecret
    @State private var testResult: String?
    @State private var testSucceeded = false
    @State private var isTesting = false

    // サーバー設定(/api/settings)。読み込み完了まで nil
    @State private var settings: ServerSettings?
    @State private var settingsError: String?
    @State private var isSavingSettings = false
    /// タイムゾーン・冒険日確率は編集途中の値をローカルに持ち、確定時(return / ドラッグ終了)に保存する
    @State private var timezoneText = ""
    @State private var adventureValue = 0.0

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if settings != nil {
                        dailySection
                        contextSection
                        if let settingsError {
                            Text(settingsError)
                                .font(.footnote)
                                .foregroundStyle(.red)
                                .padding(.top, 8)
                        }
                    } else {
                        settingsPlaceholder
                    }
                    connectionSection
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 24)
            }
            .background(Color.appBackground)
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("設定")
            .task { await loadSettings() }
        }
    }

    // MARK: - 毎日の自動生成

    @ViewBuilder
    private var dailySection: some View {
        sectionHeader("毎日の自動生成")
        Group {
            settingRow("自動生成", hint: "毎日、設定した曲数を自動生成する") {
                Toggle("自動生成", isOn: binding(\.dailyEnabled) { SettingsUpdateRequest(dailyEnabled: $0) })
                    .labelsHidden()
                    .accessibilityIdentifier("settings.dailyEnabled")
            }
            Divider()
            settingRow("1 日の曲数", hint: "実行時刻から 1 曲ずつ順次生成する") {
                Picker("1 日の曲数", selection: binding(\.dailyCount) { SettingsUpdateRequest(dailyCount: $0) }) {
                    ForEach(1..<11, id: \.self) { count in
                        Text("\(count) 曲").tag(count)
                    }
                }
                .pickerStyle(.menu)
                .tint(Color.accentDeep)
                .accessibilityIdentifier("settings.dailyCount")
            }
            Divider()
            settingRow("実行時刻", hint: "タイムゾーン基準") {
                Picker("実行時刻", selection: binding(\.dailyHour) { SettingsUpdateRequest(dailyHour: $0) }) {
                    ForEach(0..<24, id: \.self) { hour in
                        Text("\(hour) 時").tag(hour)
                    }
                }
                .pickerStyle(.menu)
                .tint(Color.accentDeep)
                .accessibilityIdentifier("settings.dailyHour")
            }
            Divider()
            VStack(alignment: .leading, spacing: 8) {
                rowLabel("タイムゾーン", hint: "IANA 名(例: America/Los_Angeles, Asia/Tokyo)")
                TextField("Asia/Tokyo", text: $timezoneText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .onSubmit { saveTimezone() }
                    .font(.subheadline)
                    .padding(10)
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color(.separator)))
                    .accessibilityIdentifier("settings.dailyTimezone")
            }
            .padding(.vertical, 10)
            Divider()
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    rowLabel("冒険日の確率", hint: "好みから大きく外した曲に挑戦する日")
                    Spacer(minLength: 12)
                    Text("\(Int((adventureValue * 100).rounded())) %")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.accentDeep)
                        .monospacedDigit()
                }
                Slider(value: $adventureValue, in: 0...1, step: 0.05) { editing in
                    if !editing { saveAdventure() }
                }
                .accessibilityIdentifier("settings.adventure")
            }
            .padding(.vertical, 10)
        }
        .disabled(isSavingSettings)
    }

    // MARK: - 今日のコンテキスト

    @ViewBuilder
    private var contextSection: some View {
        sectionHeader("今日のコンテキスト")
        Text("毎日の自動生成のプロンプトに、その日のニュースを着想として注入する。変更は次の生成から反映される。")
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.bottom, 4)
        Group {
            settingRow("ニュース", hint: "Google News の米国版(英語)トップニュース見出し") {
                Toggle("ニュース", isOn: binding(\.contextNews) { SettingsUpdateRequest(contextNews: $0) })
                    .labelsHidden()
                    .accessibilityIdentifier("settings.contextNews")
            }
        }
        .disabled(isSavingSettings)
    }

    /// 読み込み中/失敗時にサーバー設定 2 セクションの代わりに出すプレースホルダ
    @ViewBuilder
    private var settingsPlaceholder: some View {
        sectionHeader("サーバー設定")
        if let settingsError {
            Text(settingsError)
                .font(.footnote)
                .foregroundStyle(.red)
            Button("再読み込み") {
                Task { await loadSettings() }
            }
            .font(.subheadline.weight(.bold))
            .tint(.accentDeep)
            .padding(.vertical, 13)
            .accessibilityIdentifier("settings.reload")
        } else {
            HStack(spacing: 10) {
                ProgressView()
                Text("読み込み中…")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 13)
        }
    }

    // MARK: - サーバー接続

    @ViewBuilder
    private var connectionSection: some View {
        sectionHeader("サーバー接続")
        VStack(spacing: 12) {
            TextField("サーバー URL", text: $baseURL)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.subheadline)
                .padding(10)
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color(.separator)))
                .accessibilityIdentifier("settings.baseURL")
            SecureField("API Secret", text: $apiSecret)
                .font(.subheadline)
                .padding(10)
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color(.separator)))
                .accessibilityIdentifier("settings.apiSecret")
        }
        Text("既定値はビルド時に埋め込まれる(run-ios-device.sh が Mac の IP と .env の API_SECRET を注入)。ここで上書きできる。")
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.top, 10)

        Divider()
            .padding(.top, 18)

        HStack(spacing: 12) {
            Button {
                Task { await test() }
            } label: {
                if isTesting {
                    ProgressView()
                } else {
                    Text("接続テスト")
                        .font(.subheadline.weight(.bold))
                }
            }
            .tint(.accentDeep)
            .disabled(isTesting)
            .accessibilityIdentifier("settings.test")

            if let testResult {
                Text(testResult)
                    .font(.footnote)
                    .foregroundStyle(testSucceeded ? .green : .red)
            }
        }
        .padding(.vertical, 13)
    }

    // MARK: - 行の部品

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.footnote.weight(.bold))
            .foregroundStyle(.secondary)
            .padding(.top, 18)
            .padding(.bottom, 6)
    }

    private func rowLabel(_ title: String, hint: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.subheadline)
            Text(hint)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private func settingRow(_ title: String, hint: String, @ViewBuilder control: () -> some View) -> some View {
        HStack(spacing: 12) {
            rowLabel(title, hint: hint)
            Spacer(minLength: 0)
            control()
        }
        .padding(.vertical, 10)
    }

    // MARK: - サーバー設定の読み書き

    /// トグル・ピッカー用バインディング。表示へ楽観反映してから即 PUT する
    private func binding<T>(
        _ keyPath: WritableKeyPath<ServerSettings, T>,
        update: @escaping (T) -> SettingsUpdateRequest
    ) -> Binding<T> where T: Equatable {
        Binding(
            get: { settings?[keyPath: keyPath] ?? ServerSettings.placeholder[keyPath: keyPath] },
            set: { newValue in
                guard settings?[keyPath: keyPath] != newValue else { return }
                settings?[keyPath: keyPath] = newValue
                save(update(newValue))
            }
        )
    }

    private func saveTimezone() {
        let tz = timezoneText.trimmingCharacters(in: .whitespaces)
        guard let settings, !tz.isEmpty, tz != settings.dailyTimezone else { return }
        save(SettingsUpdateRequest(dailyTimezone: tz))
    }

    private func saveAdventure() {
        guard let settings, adventureValue != settings.adventureProbability else { return }
        save(SettingsUpdateRequest(adventureProbability: adventureValue))
    }

    /// 変更を即 PUT し、応答のサーバー値で表示を上書きする。失敗時はエラーを表示して現在値を読み直す
    private func save(_ update: SettingsUpdateRequest) {
        Task {
            isSavingSettings = true
            defer { isSavingSettings = false }
            do {
                apply(try await BackendAPI.putJSON(SettingsResponse.self, path: "/api/settings", body: update).settings)
                settingsError = nil
            } catch {
                settingsError = error.localizedDescription
                await loadSettings(keepError: true)
            }
        }
    }

    private func loadSettings(keepError: Bool = false) async {
        do {
            apply(try await BackendAPI.getJSON(SettingsResponse.self, path: "/api/settings").settings)
            if !keepError { settingsError = nil }
        } catch {
            if !keepError { settingsError = error.localizedDescription }
        }
    }

    private func apply(_ new: ServerSettings) {
        settings = new
        timezoneText = new.dailyTimezone
        adventureValue = new.adventureProbability
    }

    private func test() async {
        isTesting = true
        defer { isTesting = false }
        do {
            _ = try await BackendAPI.getJSON(PingResponse.self, path: "/api/ping")
            testResult = "接続 OK(認証成功)"
            testSucceeded = true
        } catch {
            testResult = error.localizedDescription
            testSucceeded = false
        }
        // 接続先を直してテストした直後にサーバー設定も取り直す
        if testSucceeded && settings == nil {
            await loadSettings()
        }
    }
}

private extension ServerSettings {
    /// settings 未読込時にバインディングの get が返すダミー(未読込中はコントロール自体を表示しない)
    static let placeholder = ServerSettings(
        dailyEnabled: false, adventureProbability: 0, dailyHour: 0,
        dailyTimezone: "", dailyCount: 1, contextNews: false
    )
}
