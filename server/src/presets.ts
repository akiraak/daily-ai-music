// 初期プリセット。起動時に presets テーブルが空ならこのセットを投入する
// value は Suno のスタイルプロンプトに使う英語表現、label_ja は管理画面・アプリの表示用

export const CATEGORY_LABELS: Record<string, string> = {
  genre: "ジャンル",
  instrument: "楽器",
  mood: "ムード",
  tempo: "テンポ",
  vocal: "歌声",
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

  // 歌声(性別 × 声質 × 年齢感 + アンサンブル・特殊系で広い声色をカバーする)
  { category: "vocal", value: "clear bright female vocals", labelJa: "透明感のある女性ボーカル" },
  { category: "vocal", value: "sweet breathy female vocals", labelJa: "甘く息づかいのある女性ボーカル" },
  { category: "vocal", value: "powerful soulful female vocals", labelJa: "パワフルでソウルフルな女性ボーカル" },
  { category: "vocal", value: "husky smoky female vocals", labelJa: "ハスキーでスモーキーな女性ボーカル" },
  { category: "vocal", value: "deep mature female vocals", labelJa: "低く落ち着いた大人の女性ボーカル" },
  { category: "vocal", value: "youthful cute female vocals", labelJa: "若くかわいらしい女性ボーカル" },
  { category: "vocal", value: "ethereal airy female vocals", labelJa: "幻想的で浮遊感のある女性ボーカル" },
  { category: "vocal", value: "operatic soprano vocals", labelJa: "オペラ風ソプラノ" },
  { category: "vocal", value: "warm baritone male vocals", labelJa: "温かいバリトンの男性ボーカル" },
  { category: "vocal", value: "deep gravelly male vocals", labelJa: "低くしゃがれた男性ボーカル" },
  { category: "vocal", value: "smooth tenor male vocals", labelJa: "なめらかなテノールの男性ボーカル" },
  { category: "vocal", value: "raspy rock male vocals", labelJa: "かすれ声のロック男性ボーカル" },
  { category: "vocal", value: "gentle falsetto male vocals", labelJa: "優しいファルセットの男性ボーカル" },
  { category: "vocal", value: "youthful energetic male vocals", labelJa: "若く元気な男性ボーカル" },
  { category: "vocal", value: "soulful R&B male vocals", labelJa: "ソウルフルな R&B 男性ボーカル" },
  { category: "vocal", value: "male and female duet vocals", labelJa: "男女デュエット" },
  { category: "vocal", value: "gospel choir harmonies", labelJa: "ゴスペル聖歌隊のハーモニー" },
  { category: "vocal", value: "children's choir", labelJa: "子どもの合唱" },
  { category: "vocal", value: "whispered delicate vocals", labelJa: "ささやくような繊細なボーカル" },
  { category: "vocal", value: "robotic vocoder vocals", labelJa: "ロボット風ボコーダーボーカル" },
];
