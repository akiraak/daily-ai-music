import Foundation

enum AppSettingsKeys {
    static let backendBaseURL = "backendBaseURL"
    static let apiSecret = "apiSecret"
    /// 生成 UI 再構築(docs/plans/generation-ui-restructure.md)の案 1 / 案 2 を実機で
    /// 見比べるための一時的な切り替え。構成が決まったら削除する
    static let uiVariant = "uiVariant"

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

/// タブ構成の比較用の値(`AppSettingsKeys.uiVariant`)。構成が決まったら削除する
enum UIVariant {
    /// 案 1: 参照曲を独立タブに(ライブラリ / 生成 / 参照曲 / 設定)
    static let fourTabs = "four_tabs"
    /// 案 2: 3 タブのまま、生成タブ内に「参照曲の管理」を置く
    static let threeTabs = "three_tabs"
    static let `default` = fourTabs
}
