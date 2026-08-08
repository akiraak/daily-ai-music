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

// 天気の都市(都道府県庁所在地)。座標は Open-Meteo Geocoding から一括取得した値。
// 選択時に都市名+座標を 1 回の PUT で同時保存する(名前と座標の不整合を防ぐ)
const CITIES = [
  { name: "札幌", lat: 43.0667, lon: 141.35 },
  { name: "青森", lat: 40.8167, lon: 140.7333 },
  { name: "盛岡", lat: 39.7, lon: 141.15 },
  { name: "仙台", lat: 38.2667, lon: 140.8667 },
  { name: "秋田", lat: 39.7167, lon: 140.1167 },
  { name: "山形", lat: 38.2333, lon: 140.3667 },
  { name: "福島", lat: 37.75, lon: 140.4667 },
  { name: "水戸", lat: 36.35, lon: 140.45 },
  { name: "宇都宮", lat: 36.5667, lon: 139.8833 },
  { name: "前橋", lat: 36.4, lon: 139.0833 },
  { name: "さいたま", lat: 35.9081, lon: 139.6566 },
  { name: "千葉", lat: 35.6, lon: 140.1167 },
  { name: "東京", lat: 35.6895, lon: 139.6917 },
  { name: "横浜", lat: 35.4333, lon: 139.65 },
  { name: "新潟", lat: 37.9226, lon: 139.0412 },
  { name: "富山", lat: 36.7, lon: 137.2167 },
  { name: "金沢", lat: 36.6, lon: 136.6167 },
  { name: "福井", lat: 36.0644, lon: 136.2226 },
  { name: "甲府", lat: 35.6667, lon: 138.5667 },
  { name: "長野", lat: 36.65, lon: 138.1833 },
  { name: "岐阜", lat: 35.4229, lon: 136.7604 },
  { name: "静岡", lat: 34.9833, lon: 138.3833 },
  { name: "名古屋", lat: 35.1815, lon: 136.9064 },
  { name: "津", lat: 34.7333, lon: 136.5167 },
  { name: "大津", lat: 35.0, lon: 135.8667 },
  { name: "京都", lat: 35.0211, lon: 135.7538 },
  { name: "大阪", lat: 34.6938, lon: 135.5011 },
  { name: "神戸", lat: 34.6913, lon: 135.183 },
  { name: "奈良", lat: 34.6851, lon: 135.8049 },
  { name: "和歌山", lat: 34.2333, lon: 135.1667 },
  { name: "鳥取", lat: 35.5, lon: 134.2333 },
  { name: "松江", lat: 35.4833, lon: 133.05 },
  { name: "岡山", lat: 34.65, lon: 133.9333 },
  { name: "広島", lat: 34.4, lon: 132.45 },
  { name: "山口", lat: 34.1833, lon: 131.4667 },
  { name: "徳島", lat: 34.0667, lon: 134.5667 },
  { name: "高松", lat: 34.3333, lon: 134.05 },
  { name: "松山", lat: 33.8392, lon: 132.7657 },
  { name: "高知", lat: 33.55, lon: 133.5333 },
  { name: "福岡", lat: 33.6, lon: 130.4167 },
  { name: "佐賀", lat: 33.2333, lon: 130.3 },
  { name: "長崎", lat: 32.75, lon: 129.8833 },
  { name: "熊本", lat: 32.8059, lon: 130.6918 },
  { name: "大分", lat: 33.2333, lon: 131.6 },
  { name: "宮崎", lat: 31.9167, lon: 131.4167 },
  { name: "鹿児島", lat: 31.5667, lon: 130.55 },
  { name: "那覇", lat: 26.213, lon: 127.6785 },
];

const citySelect = $("weather-city");

function applyCity(settings) {
  const options = CITIES.map((c) => {
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = c.name;
    return opt;
  });
  // 保存済みの都市名がリストに無い場合(旧データで座標だけ設定済み等)は現在値を先頭に足す
  if (!CITIES.some((c) => c.name === settings.weatherCity)) {
    const opt = document.createElement("option");
    opt.value = settings.weatherCity;
    opt.textContent = `${settings.weatherCity}(現在の設定)`;
    options.unshift(opt);
  }
  citySelect.replaceChildren(...options);
  citySelect.value = settings.weatherCity;
}

citySelect.addEventListener("change", async () => {
  const city = CITIES.find((c) => c.name === citySelect.value);
  if (!city) return;
  citySelect.disabled = true;
  try {
    const { settings } = await fetchJson("/admin/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        weatherCity: city.name,
        weatherLat: city.lat,
        weatherLon: city.lon,
      }),
    });
    applyCity(settings);
    showMessage("保存しました", false);
  } catch (err) {
    showMessage(err.message, true);
    await load();
  } finally {
    citySelect.disabled = false;
  }
});

function applySettings(settings) {
  for (const el of controls) {
    const value = settings[el.dataset.field];
    if (value === undefined) continue;
    if (el.type === "checkbox") el.checked = value === true;
    else el.value = String(value);
  }
  applyCity(settings);
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
