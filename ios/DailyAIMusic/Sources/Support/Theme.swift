import SwiftUI
import UIKit

/// アプリアイコン実測色ベースのデザイントークン(docs/plans/ios-app-design.md)。
/// 実体は Assets.xcassets のカラーセット(ライト/ダーク)で、ここではセマンティック名を付けて参照する。
extension Color {
    /// ティント全般(タブ・ボタン・再生中表示・評価 ON)。ライト #B4BA40 / ダーク #C4C963
    static let appAccent = Color("AccentColor")

    /// 画面背景。ライト #FDF2E5(クリーム)/ ダーク #1C1B16(暖色系ダーク)
    static let appBackground = Color("AppBackground")

    /// カード・リスト行の面。ライト #FFFFFF / ダーク #2A2822
    static let cardBackground = Color("CardBackground")

    /// 明るい面の上の文字・小さい図形。ライト #787D2B / ダーク #C4C963
    /// (#B4BA40 は白系背景とのコントラストが弱いため文字には使わない)
    static let accentDeep = Color("AccentDeep")
}

/// 案A ミニマル(docs/plans/ios-app-design-mocks/01-minimal.html)のバー外観。
/// タブは選択中アイコン = AccentColor・ラベル = AccentDeep、ナビの文字ボタン(戻る等)= AccentDeep。
/// バー背景は標準のまま(iOS 26 でナビの appearance 上書きが大タイトルを消すため背景には触らない)。
enum AppAppearance {
    static func configure() {
        UINavigationBar.appearance().tintColor = UIColor(named: "AccentDeep")

        let tab = UITabBarAppearance()
        tab.configureWithDefaultBackground()
        for item in [tab.stackedLayoutAppearance, tab.inlineLayoutAppearance, tab.compactInlineLayoutAppearance] {
            if let accent = UIColor(named: "AccentColor") { item.selected.iconColor = accent }
            if let deep = UIColor(named: "AccentDeep") { item.selected.titleTextAttributes = [.foregroundColor: deep] }
        }
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
    }
}
