import SwiftUI

/// 設定タブ。機能はサーバー接続(URL・Secret・接続テスト)のみで Phase 7 で
/// 他画面と同じ ScrollView + VStack(横 22pt・ヘアライン区切り)構成に統一した。
/// レイアウトは案A ミニマル基準
struct SettingsView: View {
    @AppStorage(AppSettingsKeys.backendBaseURL) private var baseURL = AppSettingsKeys.defaultBackendBaseURL
    @AppStorage(AppSettingsKeys.apiSecret) private var apiSecret = AppSettingsKeys.defaultAPISecret
    @State private var testResult: String?
    @State private var testSucceeded = false
    @State private var isTesting = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("サーバー接続")
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(.secondary)
                        .padding(.top, 18)
                        .padding(.bottom, 10)

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
                .padding(.horizontal, 22)
                .padding(.bottom, 24)
            }
            .background(Color.appBackground)
            .navigationTitle("設定")
        }
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
    }
}
