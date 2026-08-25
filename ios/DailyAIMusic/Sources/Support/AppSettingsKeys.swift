import Foundation

enum AppSettingsKeys {
    static let backendBaseURL = "backendBaseURL"
    static let apiSecret = "apiSecret"
    /// ランダム再生(シャッフル)の ON/OFF。フルプレイヤーのトグルが唯一の入口なので、
    /// 一度 ON にしたら次の起動でも効くように保存する
    static let shuffleEnabled = "playerShuffleEnabled"

    /// ビルド時に Info.plist へ埋め込まれた値(実機ビルドは run-ios-device.sh が
    /// 本番 URL https://music.chobi.me を注入する。--local 時は Mac の LAN IP)。
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
