import Foundation

enum AppSettingsKeys {
    static let backendBaseURL = "backendBaseURL"
    static let apiSecret = "apiSecret"

    /// ビルド時に Info.plist へ埋め込まれた値(実機ビルドは run-ios-device.sh が Mac の IP を注入する)。
    /// 未設定・空ならローカル開発サーバーにフォールバックする(シミュレータ向け)
    static var defaultBackendBaseURL: String {
        if let value = Bundle.main.object(forInfoDictionaryKey: "BackendBaseURL") as? String,
           !value.isEmpty {
            return value
        }
        return "http://localhost:3014"
    }

    /// /api/* 認証用の X-API-Secret ヘッダ値。ビルド時に Info.plist へ埋め込める
    /// (run-ios-device.sh が .env の API_SECRET を注入する)。既定は空=未設定で、
    /// その場合は設定画面での入力が必要。secret 値はコードにハードコードしない
    static var defaultAPISecret: String {
        if let value = Bundle.main.object(forInfoDictionaryKey: "BackendAPISecret") as? String,
           !value.isEmpty {
            return value
        }
        return ""
    }
}
