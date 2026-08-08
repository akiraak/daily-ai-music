import SwiftUI

struct SettingsView: View {
    @AppStorage(AppSettingsKeys.backendBaseURL) private var baseURL = AppSettingsKeys.defaultBackendBaseURL
    @AppStorage(AppSettingsKeys.apiSecret) private var apiSecret = AppSettingsKeys.defaultAPISecret
    @State private var testResult: String?
    @State private var testSucceeded = false
    @State private var isTesting = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("サーバー URL", text: $baseURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("API Secret", text: $apiSecret)
                } header: {
                    Text("サーバー接続")
                } footer: {
                    Text("既定値はビルド時に埋め込まれる(run-ios-device.sh が Mac の IP と .env の API_SECRET を注入)。ここで上書きできる。")
                }
                .listRowBackground(Color.appBackground)

                Section {
                    Button {
                        Task { await test() }
                    } label: {
                        if isTesting {
                            ProgressView()
                        } else {
                            Text("接続テスト")
                        }
                    }
                    .tint(.accentDeep)
                    .disabled(isTesting)
                    if let testResult {
                        Text(testResult)
                            .font(.footnote)
                            .foregroundStyle(testSucceeded ? .green : .red)
                    }
                }
                .listRowBackground(Color.appBackground)
            }
            .scrollContentBackground(.hidden)
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
