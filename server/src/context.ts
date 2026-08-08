// 外部コンテキスト(ニュース・天気)の取得。毎日の自動生成のプロンプトに
// 「今日のコンテキスト」として注入する。外部取得の失敗で生成を止めない
// (タイムアウト数秒+失敗は警告ログのみでスキップ)
import * as db from "./db.ts";

const FETCH_TIMEOUT_MS = 8_000;
const NEWS_RSS_URL = "https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja";
const NEWS_MAX_ITEMS = 8;

export const CONTEXT_SETTING_DEFAULTS = {
  contextNews: true,
  contextWeather: true,
  weatherCity: "東京", // 表示用の都市名(座標とセットで保存される)
  weatherLat: 35.6895,
  weatherLon: 139.6917,
} as const;

export interface ContextSettings {
  contextNews: boolean;
  contextWeather: boolean;
  weatherCity: string;
  weatherLat: number;
  weatherLon: number;
}

export function getContextSettings(): ContextSettings {
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return v !== undefined && Number.isFinite(n) ? n : fallback;
  };
  return {
    contextNews:
      (db.getSetting("context_news") ??
        String(CONTEXT_SETTING_DEFAULTS.contextNews)) === "true",
    contextWeather:
      (db.getSetting("context_weather") ??
        String(CONTEXT_SETTING_DEFAULTS.contextWeather)) === "true",
    weatherCity: db.getSetting("weather_city") ?? CONTEXT_SETTING_DEFAULTS.weatherCity,
    weatherLat: num(db.getSetting("weather_lat"), CONTEXT_SETTING_DEFAULTS.weatherLat),
    weatherLon: num(db.getSetting("weather_lon"), CONTEXT_SETTING_DEFAULTS.weatherLon),
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

// WMO weather code → 日本語の天気表現
function weatherLabel(code: number): string {
  if (code === 0) return "快晴";
  if (code === 1) return "晴れ";
  if (code === 2) return "晴れ時々曇り";
  if (code === 3) return "曇り";
  if (code === 45 || code === 48) return "霧";
  if (code >= 51 && code <= 57) return "霧雨";
  if ((code >= 61 && code <= 67) || code === 80 || code === 81) return "雨";
  if (code === 82) return "激しい雨";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "雪";
  if (code >= 95) return "雷雨";
  return `不明 (code=${code})`;
}

// Open-Meteo(キー不要)で当日の天気・気温を取得する
async function fetchWeather(
  city: string,
  lat: number,
  lon: number
): Promise<string | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
    `&timezone=auto&forecast_days=1`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as {
    current?: { temperature_2m?: number; weather_code?: number };
    daily?: {
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
    };
  };
  const code = data.daily?.weather_code?.[0] ?? data.current?.weather_code;
  if (code === undefined) return null;
  const parts = [weatherLabel(code)];
  const max = data.daily?.temperature_2m_max?.[0];
  const min = data.daily?.temperature_2m_min?.[0];
  if (max !== undefined && min !== undefined) {
    parts.push(`最高 ${Math.round(max)}°C / 最低 ${Math.round(min)}°C`);
  }
  const current = data.current?.temperature_2m;
  if (current !== undefined) parts.push(`現在 ${Math.round(current)}°C`);
  return `### 今日の天気(${city})\n${parts.join("、")}(ムードやテンポの着想に)`;
}

interface ContextSource {
  name: string;
  enabled: (s: ContextSettings) => boolean;
  fetch: (s: ContextSettings) => Promise<string | null>;
}

const SOURCES: ContextSource[] = [
  { name: "news", enabled: (s) => s.contextNews, fetch: () => fetchNews() },
  {
    name: "weather",
    enabled: (s) => s.contextWeather,
    fetch: (s) => fetchWeather(s.weatherCity, s.weatherLat, s.weatherLon),
  },
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
