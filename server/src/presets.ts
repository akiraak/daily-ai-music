// 初期プリセット。起動時に presets テーブルが空ならこのセットを投入する
// value は Suno のスタイルプロンプトに使う英語表現、label_ja は管理画面・アプリの表示用

export const CATEGORY_LABELS: Record<string, string> = {
  genre: "ジャンル",
  instrument: "楽器",
  mood: "ムード",
  tempo: "テンポ",
};

export const SEED_PRESETS: {
  category: string;
  value: string;
  labelJa: string;
}[] = [
  // ジャンル
  { category: "genre", value: "lo-fi hip hop", labelJa: "ローファイ・ヒップホップ" },
  { category: "genre", value: "acoustic folk", labelJa: "アコースティックフォーク" },
  { category: "genre", value: "indie pop", labelJa: "インディーポップ" },
  { category: "genre", value: "jazz", labelJa: "ジャズ" },
  { category: "genre", value: "bossa nova", labelJa: "ボサノバ" },
  { category: "genre", value: "city pop", labelJa: "シティポップ" },
  { category: "genre", value: "synthwave", labelJa: "シンセウェイブ" },
  { category: "genre", value: "ambient", labelJa: "アンビエント" },
  { category: "genre", value: "R&B", labelJa: "R&B" },
  { category: "genre", value: "rock", labelJa: "ロック" },
  { category: "genre", value: "deep house", labelJa: "ディープハウス" },
  { category: "genre", value: "orchestral", labelJa: "オーケストラ" },

  // 楽器
  { category: "instrument", value: "acoustic guitar", labelJa: "アコースティックギター" },
  { category: "instrument", value: "piano", labelJa: "ピアノ" },
  { category: "instrument", value: "electric piano", labelJa: "エレクトリックピアノ" },
  { category: "instrument", value: "synthesizer", labelJa: "シンセサイザー" },
  { category: "instrument", value: "strings", labelJa: "ストリングス" },
  { category: "instrument", value: "saxophone", labelJa: "サックス" },
  { category: "instrument", value: "trumpet", labelJa: "トランペット" },
  { category: "instrument", value: "electric guitar", labelJa: "エレキギター" },
  { category: "instrument", value: "upright bass", labelJa: "ウッドベース" },
  { category: "instrument", value: "flute", labelJa: "フルート" },
  { category: "instrument", value: "ukulele", labelJa: "ウクレレ" },

  // ムード
  { category: "mood", value: "calm and warm", labelJa: "穏やかで温かい" },
  { category: "mood", value: "energetic", labelJa: "エネルギッシュ" },
  { category: "mood", value: "melancholic", labelJa: "メランコリック" },
  { category: "mood", value: "dreamy", labelJa: "夢見心地" },
  { category: "mood", value: "uplifting", labelJa: "前向き" },
  { category: "mood", value: "nostalgic", labelJa: "ノスタルジック" },
  { category: "mood", value: "relaxing", labelJa: "リラックス" },
  { category: "mood", value: "mysterious", labelJa: "ミステリアス" },
  { category: "mood", value: "romantic", labelJa: "ロマンチック" },
  { category: "mood", value: "playful", labelJa: "遊び心のある" },

  // テンポ
  { category: "tempo", value: "slow ballad", labelJa: "スローバラード" },
  { category: "tempo", value: "mid-tempo", labelJa: "ミッドテンポ" },
  { category: "tempo", value: "uptempo", labelJa: "アップテンポ" },
  { category: "tempo", value: "driving beat", labelJa: "疾走感のあるビート" },
];
