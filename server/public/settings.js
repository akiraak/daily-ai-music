// 設定ページ。外部コンテキスト(ニュース・天気)と毎日の自動生成のパラメータを表示・変更する。
// 保存ボタンは置かず、トグル・入力の変更で即 PUT する(評価ボタンと同じ操作感)
// (/admin/api/* は同居サーバーの無認証 API。本番はエッジの Cloudflare Access が /admin ごと保護する)
const $ = (id) => document.getElementById(id);

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json;
}

let messageTimer = null;
function showMessage(text, isError) {
  const el = $("settings-message");
  el.textContent = text ?? "";
  el.hidden = !text;
  el.classList.toggle("info", !isError);
  clearTimeout(messageTimer);
  if (text && !isError) {
    messageTimer = setTimeout(() => { el.hidden = true; }, 2000);
  }
}

const controls = [...document.querySelectorAll("[data-field]")];

function applySettings(settings) {
  for (const el of controls) {
    const value = settings[el.dataset.field];
    if (value === undefined) continue;
    if (el.type === "checkbox") el.checked = value === true;
    else el.value = String(value);
  }
}

async function load() {
  try {
    const { settings } = await fetchJson("/admin/api/settings");
    applySettings(settings);
  } catch (err) {
    showMessage(`設定の読み込みに失敗しました: ${err.message}`, true);
  }
}

async function save(el) {
  const field = el.dataset.field;
  let value;
  if (el.type === "checkbox") {
    value = el.checked;
  } else if (el.type === "number") {
    value = Number(el.value);
    if (el.value === "" || !Number.isFinite(value)) {
      showMessage("数値を入力してください", true);
      return load(); // 表示をサーバーの現在値に戻す
    }
  } else {
    value = el.value.trim();
  }
  for (const c of controls) c.disabled = true;
  try {
    const { settings } = await fetchJson("/admin/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    applySettings(settings);
    showMessage("保存しました", false);
  } catch (err) {
    showMessage(err.message, true);
    await load();
  } finally {
    for (const c of controls) c.disabled = false;
  }
}

for (const el of controls) {
  el.addEventListener("change", () => save(el));
}

load();
