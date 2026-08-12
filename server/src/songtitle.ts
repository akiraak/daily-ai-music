// 曲名から「別バージョン・派生音源」を見分ける判定。DB にも参照曲の選択にも依存しない。
//
// 2026-08-11 に reference.ts から移設した。以前は生成のたびに候補から除外していたが、
// 今は artist_songs.enabled の「取り込み時の初期値」を決めるだけに使う(以後は人が上書きできる)。
// db.ts から呼ぶため、db.ts を import している reference.ts には置けない(循環参照になる)

// 別バージョン・派生音源を示す語。iTunes の取り込みは曲名の完全一致でしか重複を畳まないため、
// 同じ曲のライブ版・リミックスがそのまま候補に残る。参照曲としては原曲を引きたい
const NOISE_KEYWORDS = [
  "live",
  "remix",
  "instrumental",
  "karaoke",
  "cover",
  "off vocal",
  "acoustic version",
  "acoustic ver",
  "demo",
  "remaster",
  "remastered",
  "radio edit",
  "tv size",
  "a cappella",
  "acappella",
  "backing track",
  "reprise",
  "medley",
  "ライブ",
  "ライヴ",
  "カラオケ",
  "インスト",
  "オフボーカル",
];

// ASCII の語は語境界で見る(「cover」が「discovery」に誤ヒットしないように)。
// 日本語などの非 ASCII は語境界の概念が無いので単純な部分一致
function containsKeyword(lower: string, keyword: string): boolean {
  if (/^[\x20-\x7e]+$/.test(keyword)) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(lower);
  }
  return lower.includes(keyword);
}

// 曲名のうち、括弧書き・ダッシュ以降の「注釈」部分だけを取り出す。
// 本題側は見ない(「Live and Let Die」「Cover Me」のような原曲を落とさないため)
function annotations(title: string): string[] {
  const parts: string[] = title.match(/[([{（【][^)\]}）】]*[)\]}）】]/g) ?? [];
  parts.push(...title.split(/\s[-–—~〜]\s?/).slice(1));
  return parts;
}

export function isNoisyTitle(title: string): boolean {
  return annotations(title).some((part) => {
    const lower = part.toLowerCase();
    return NOISE_KEYWORDS.some((k) => containsKeyword(lower, k));
  });
}
