// 外部コンテキスト(ニュース)の取得。毎日の自動生成のプロンプトに
// 「今日のコンテキスト」として注入する。外部取得の失敗で生成を止めない
// (タイムアウト数秒+失敗は警告ログのみでスキップ)
import * as db from "./db.ts";

const FETCH_TIMEOUT_MS = 8_000;
const NEWS_RSS_URL = "https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja";
const NEWS_MAX_ITEMS = 8;

export const CONTEXT_SETTING_DEFAULTS = {
  contextNews: true,
} as const;

export interface ContextSettings {
  contextNews: boolean;
}

export function getContextSettings(): ContextSettings {
  return {
    contextNews:
      (db.getSetting("context_news") ??
        String(CONTEXT_SETTING_DEFAULTS.contextNews)) === "true",
  };
}

async function fetchWithTimeout(url: string): Promise<Response> {
  return await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");
}

// Google News RSS(日本版トップニュース)の見出し上位を整形して返す
async function fetchNews(): Promise<string | null> {
  const res = await fetchWithTimeout(NEWS_RSS_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const titles = [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)]
    .map((m) => decodeXmlEntities(m[1]).trim())
    .filter((t) => t.length > 0)
    .slice(0, NEWS_MAX_ITEMS);
  if (titles.length === 0) return null;
  return [
    "### 今日の主なニュース(見出し)",
    "この中から 1 つ選び、雰囲気・テーマとして織り込む(時事の固有名詞を歌詞に直接入れない)。",
    ...titles.map((t) => `- ${t}`),
  ].join("\n");
}

interface ContextSource {
  name: string;
  enabled: (s: ContextSettings) => boolean;
  fetch: (s: ContextSettings) => Promise<string | null>;
}

const SOURCES: ContextSource[] = [
  { name: "news", enabled: (s) => s.contextNews, fetch: () => fetchNews() },
];

// 有効なソースを並行取得し、得られたものだけを結合して返す(全滅・全 OFF なら null)
export async function buildTodayContext(): Promise<string | null> {
  const settings = getContextSettings();
  const results = await Promise.all(
    SOURCES.filter((s) => s.enabled(settings)).map(async (s) => {
      try {
        return await s.fetch(settings);
      } catch (err) {
        console.warn(`[context] ${s.name} の取得に失敗(スキップ): ${err}`);
        return null;
      }
    })
  );
  const parts = results.filter((r): r is string => r !== null && r.length > 0);
  return parts.length > 0 ? parts.join("\n\n") : null;
}
