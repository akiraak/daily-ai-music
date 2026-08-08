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
            .navigationTitle("設定")
            .task { await loadSettings() }
        }
    }

    // MARK: - 毎日の自動生成

    @ViewBuilder
    private var dailySection: some View {
        sectionHeader("毎日の自動生成")
        Group {
            settingRow("自動生成", hint: "毎日 1 曲を自動生成する") {
                Toggle("自動生成", isOn: binding(\.dailyEnabled) { SettingsUpdateRequest(dailyEnabled: $0) })
                    .labelsHidden()
                    .accessibilityIdentifier("settings.dailyEnabled")
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
        Text("毎日の自動生成のプロンプトに、その日のニュース・天気を着想として注入する。変更は次の生成から反映される。")
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.bottom, 4)
        Group {
            settingRow("ニュース", hint: "Google News の日本版トップニュース見出し") {
                Toggle("ニュース", isOn: binding(\.contextNews) { SettingsUpdateRequest(contextNews: $0) })
                    .labelsHidden()
                    .accessibilityIdentifier("settings.contextNews")
            }
            Divider()
            settingRow("天気", hint: "Open-Meteo の当日の天気・気温") {
                Toggle("天気", isOn: binding(\.contextWeather) { SettingsUpdateRequest(contextWeather: $0) })
                    .labelsHidden()
                    .accessibilityIdentifier("settings.contextWeather")
            }
            Divider()
            settingRow("天気の都市", hint: "都道府県庁所在地から選択") {
                Picker("天気の都市", selection: cityBinding) {
                    if let current = settings?.weatherCity,
                       !Self.cities.contains(where: { $0.name == current }) {
                        Text("\(current)(現在の設定)").tag(current)
                    }
                    ForEach(Self.cities, id: \.name) { city in
                        Text(city.name).tag(city.name)
                    }
                }
                .pickerStyle(.menu)
                .tint(Color.accentDeep)
                .accessibilityIdentifier("settings.weatherCity")
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

    /// 都市は名前+座標を 1 回の PUT で同時保存する(管理画面 settings.js と同じ)
    private var cityBinding: Binding<String> {
        Binding(
            get: { settings?.weatherCity ?? "" },
            set: { name in
                guard name != settings?.weatherCity,
                      let city = Self.cities.first(where: { $0.name == name }) else { return }
                settings?.weatherCity = name
                save(SettingsUpdateRequest(weatherCity: city.name, weatherLat: city.lat, weatherLon: city.lon))
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
        dailyTimezone: "", contextNews: false, contextWeather: false, weatherCity: ""
    )
}

private extension SettingsView {
    struct WeatherCity {
        let name: String
        let lat: Double
        let lon: Double
    }

    /// 天気の都市(都道府県庁所在地)。管理画面 settings.js の CITIES と同じ値
    static let cities: [WeatherCity] = [
        .init(name: "札幌", lat: 43.0667, lon: 141.35), .init(name: "青森", lat: 40.8167, lon: 140.7333),
        .init(name: "盛岡", lat: 39.7, lon: 141.15), .init(name: "仙台", lat: 38.2667, lon: 140.8667),
        .init(name: "秋田", lat: 39.7167, lon: 140.1167), .init(name: "山形", lat: 38.2333, lon: 140.3667),
        .init(name: "福島", lat: 37.75, lon: 140.4667), .init(name: "水戸", lat: 36.35, lon: 140.45),
        .init(name: "宇都宮", lat: 36.5667, lon: 139.8833), .init(name: "前橋", lat: 36.4, lon: 139.0833),
        .init(name: "さいたま", lat: 35.9081, lon: 139.6566), .init(name: "千葉", lat: 35.6, lon: 140.1167),
        .init(name: "東京", lat: 35.6895, lon: 139.6917), .init(name: "横浜", lat: 35.4333, lon: 139.65),
        .init(name: "新潟", lat: 37.9226, lon: 139.0412), .init(name: "富山", lat: 36.7, lon: 137.2167),
        .init(name: "金沢", lat: 36.6, lon: 136.6167), .init(name: "福井", lat: 36.0644, lon: 136.2226),
        .init(name: "甲府", lat: 35.6667, lon: 138.5667), .init(name: "長野", lat: 36.65, lon: 138.1833),
        .init(name: "岐阜", lat: 35.4229, lon: 136.7604), .init(name: "静岡", lat: 34.9833, lon: 138.3833),
        .init(name: "名古屋", lat: 35.1815, lon: 136.9064), .init(name: "津", lat: 34.7333, lon: 136.5167),
        .init(name: "大津", lat: 35.0, lon: 135.8667), .init(name: "京都", lat: 35.0211, lon: 135.7538),
        .init(name: "大阪", lat: 34.6938, lon: 135.5011), .init(name: "神戸", lat: 34.6913, lon: 135.183),
        .init(name: "奈良", lat: 34.6851, lon: 135.8049), .init(name: "和歌山", lat: 34.2333, lon: 135.1667),
        .init(name: "鳥取", lat: 35.5, lon: 134.2333), .init(name: "松江", lat: 35.4833, lon: 133.05),
        .init(name: "岡山", lat: 34.65, lon: 133.9333), .init(name: "広島", lat: 34.4, lon: 132.45),
        .init(name: "山口", lat: 34.1833, lon: 131.4667), .init(name: "徳島", lat: 34.0667, lon: 134.5667),
        .init(name: "高松", lat: 34.3333, lon: 134.05), .init(name: "松山", lat: 33.8392, lon: 132.7657),
        .init(name: "高知", lat: 33.55, lon: 133.5333), .init(name: "福岡", lat: 33.6, lon: 130.4167),
        .init(name: "佐賀", lat: 33.2333, lon: 130.3), .init(name: "長崎", lat: 32.75, lon: 129.8833),
        .init(name: "熊本", lat: 32.8059, lon: 130.6918), .init(name: "大分", lat: 33.2333, lon: 131.6),
        .init(name: "宮崎", lat: 31.9167, lon: 131.4167), .init(name: "鹿児島", lat: 31.5667, lon: 130.55),
        .init(name: "那覇", lat: 26.213, lon: 127.6785),
    ]
}
