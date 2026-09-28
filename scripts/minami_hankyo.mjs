// 南自動車（軽スタ）の C-MATCH 反響（物件別）CSV を取得し、
// 南自動車ダッシュボード（GAS Webアプリ）へ送って統合シートの「反響」タブを更新する。
// インディオの scripts/cmatch_hankyo.mjs と同じ取り方（ログイン → 物件別CSVダウンロード）。
//   必要な環境変数（GitHub の Secrets）:
//     MINAMI_CMATCH_ID, MINAMI_CMATCH_PW … 南自動車の C-MATCH ログイン
//     MINAMI_GAS_URL                      … ダッシュボードのURL（…/exec）
//     MINAMI_GAS_KEY                      … 統合シート「設定」タブの反響取込キー
//   任意: HANKYO_YM=202609,202608（省略時は当月。JSTで1〜3日は前月も）
import { chromium } from 'playwright';

const BASE = 'https://c-match.carsensor.net';

export function targetMonths(env = process.env, now = Date.now()) {
  if (env.HANKYO_YM) return env.HANKYO_YM.split(',').map(s => s.trim()).filter(Boolean);
  const jst = new Date(now + 9 * 3600 * 1000);
  const y = jst.getUTCFullYear(), m = jst.getUTCMonth() + 1, d = jst.getUTCDate();
  const ym = (yy, mm) => `${yy}${String(mm).padStart(2, '0')}`;
  const list = [ym(y, m)];
  if (d <= 3) { const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y; list.unshift(ym(py, pm)); }
  return list;
}

function csvUrl(ym, madoguchi) {
  const q = new URLSearchParams({
    'frmByVehicleDto.isVehicleGraphTab': 'false', 'frmByVehicleDto.madoguchiCd': madoguchi,
    'frmByVehicleDto.searchType': '0', 'frmByVehicleDto.typeDateFlg': 'true',
    'frmByVehicleDto.periodTime': '01', 'frmByVehicleDto.barometerTopKbn': '00',
    'frmByVehicleDto.barometerMiddleKbn': '31', 'frmByVehicleDto.barometerBottomKbn': '17',
    'frmByVehicleDto.hankyoYM': ym,
  });
  return `${BASE}/counter/byVehicle/doDownloadCsv?${q}`;
}

function decodeSjis(buf) {
  let t;
  try { t = new TextDecoder('shift_jis', { fatal: false }).decode(buf); } catch { t = new TextDecoder('utf-8').decode(buf); }
  if (!/メーカー/.test(t.slice(0, 4000))) t = new TextDecoder('utf-8').decode(buf);
  return t;
}

// 物件別CSV → 1台1行。列は GAS 側の HANKYO_HEADER（先頭の「月」と末尾の「取得日時」は GAS が入れる）に合わせる
const IND = {
  '詳細閲覧数': 'view', '複数画像閲覧数': 'img', 'MAP閲覧数': 'map', 'メール問合せ数（全て）': 'mail',
  'メール問合せ数（来店予約）': 'visit', '電話問合せ数': 'tel', '問合せ数（全て）': 'inq',
  '価格見直し登録': 'pw', 'お気に入り登録': 'fav',
};
function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}
export function parseCsv(text) {
  const lines = text.split(/\r?\n/);
  const hi = lines.findIndex(l => /^メーカー,車種,/.test(l));
  if (hi < 0) throw new Error('CSVの見出し行が見つかりません');
  const H = splitCsv(lines[hi]);
  const c = n => H.indexOf(n);
  const iInd = c('指標選択'), iSum = c('月間合計'), iDay = iSum + 1;
  if (iInd < 0 || iSum < 0) throw new Error('CSVの列が想定と違います');
  const cars = new Map();
  for (const line of lines.slice(hi + 1)) {
    if (!line.trim()) continue;
    const f = splitCsv(line);
    const ind = IND[f[iInd]]; if (!ind) continue;
    const key = [f[c('車台末番')], f[c('年式検索用（年）')], f[c('走行距離検索用')], f[c('本体価格検索用')]].join('|');
    let car = cars.get(key);
    if (!car) {
      car = { key, maker: f[c('メーカー')], car: f[c('車種')], grade: [f[c('グレード')], f[c('グレード補記')]].filter(Boolean).join(' '),
        price: f[c('本体価格検索用')], wareki: f[c('年式')], year: f[c('年式検索用（年）')], km: f[c('走行距離検索用')],
        suf: f[c('車台末番')], days: f[c('掲載延べ日数')], listed: f[c('掲載状況')], stock: f[c('在庫状況')], m: {}, d: {} };
      cars.set(key, car);
    }
    car.m[ind] = Number(f[iSum] || 0) || 0;
    if (ind === 'view' || ind === 'inq' || ind === 'fav') car.d[ind] = f.slice(iDay).join(',');
  }
  return [...cars.values()].map(v => ['', v.key, v.maker, v.car, v.grade, v.price, v.wareki, v.year, v.km, v.suf, v.days, v.listed, v.stock,
    v.m.view || 0, v.m.img || 0, v.m.map || 0, v.m.mail || 0, v.m.visit || 0, v.m.tel || 0, v.m.inq || 0, v.m.fav || 0, v.m.pw || 0,
    v.d.view || '', v.d.inq || '', v.d.fav || '']);
}

async function fetchCsvs(months, ID, PW) {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login/`, { waitUntil: 'load' });
    await page.fill('input[name="loginId"]', ID);
    await page.fill('input[name="passwordCd"]', PW);
    await Promise.all([page.waitForLoadState('load'), page.click('input[name="doLogin"], #sbtLogin')]);
    if (/ログイン/.test(await page.title()) || /\/login/.test(page.url())) throw new Error('C-MATCHにログインできませんでした（ID/PW、またはアクセス制限）');
    // 窓口コードは画面から読む（インディオは 003。南自動車は違う可能性があるため固定しない）
    await page.goto(`${BASE}/counter/byVehicle/`, { waitUntil: 'load' });
    const madoguchi = await page.$eval('input[name="frmByVehicleDto.madoguchiCd"]', e => e.value).catch(() => '');
    const shop = await page.$eval('body', b => (b.innerText.match(/^(.+?)\[/m) || [])[1] || '').catch(() => '');
    console.log(`店舗: ${shop.trim()} / 窓口コード: ${madoguchi || '（空）'}`);
    const csvs = {};
    for (const ym of months) {
      const res = await ctx.request.get(csvUrl(ym, madoguchi));
      if (!res.ok()) throw new Error(`CSV取得に失敗 ${ym} HTTP ${res.status()}`);
      const text = decodeSjis(await res.body());
      if (!/期間指定：/.test(text.slice(0, 4000))) throw new Error(`CSVの形式が想定と違う ${ym}`);
      const store = (text.match(/対象店舗：,([^\r\n]*)/) || [])[1] || '';
      console.log(`CSV ${ym}: ${text.length} 文字 / 対象店舗: ${store}`);
      csvs[ym] = text;
    }
    return csvs;
  } finally { await browser.close(); }
}

async function postToGas(url, key, ym, rows) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ key, ym: `${ym.slice(0, 4)}-${ym.slice(4, 6)}`, rows }), redirect: 'follow' });
  const text = await res.text();
  let r; try { r = JSON.parse(text); } catch { throw new Error(`GASの応答が読めません HTTP ${res.status}: ${text.slice(0, 200)}`); }
  if (!r.ok) throw new Error(`GASが受け付けませんでした: ${r.error}`);
  return r;
}

async function main() {
  const { MINAMI_CMATCH_ID: ID, MINAMI_CMATCH_PW: PW, MINAMI_GAS_URL: URL_, MINAMI_GAS_KEY: KEY } = process.env;
  if (!ID || !PW || !URL_ || !KEY) throw new Error('Secrets（MINAMI_CMATCH_ID / MINAMI_CMATCH_PW / MINAMI_GAS_URL / MINAMI_GAS_KEY）が足りません');
  const months = targetMonths();
  console.log('対象月:', months.join(', '));
  const csvs = await fetchCsvs(months, ID, PW);
  for (const ym of months) {
    const rows = parseCsv(csvs[ym]);
    if (!rows.length) { console.log(`${ym}: 物件0台のため送信しません`); continue; }
    const r = await postToGas(URL_, KEY, ym, rows);
    console.log(`${ym}: ${r.rows}台を送信（反響タブ合計 ${r.total}行）`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.message || e); process.exit(1); });
