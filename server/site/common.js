// 公開ページ共通(一覧・詳細)。API は /site/api/*(無認証)
async function fetchTracks() {
  const res = await fetch("/site/api/tracks");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).tracks;
}

function fmtDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtDateJa(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// 例: "Suno V5.5 · claude-sonnet-5"(旧データは llmModel が無いので Suno だけになる)
function modelLabel(t) {
  const parts = [];
  if (t.sunoModel) parts.push(`Suno ${t.sunoModel.replace("_", ".")}`);
  if (t.llmModel) parts.push(t.llmModel);
  return parts.join(" · ");
}

function trackPageUrl(t) {
  return `/track/${t.id}`;
}
