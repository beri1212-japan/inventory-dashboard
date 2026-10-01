// C-MATCH 反響（物件別）CSV を取得し、ダッシュボード本体（index.html）の取込関数で
// cmatch_latest.json を更新する。GitHub Actions / ローカルのどちらでも動く。
//   必要な環境変数: CMATCH_ID, CMATCH_PW
//   任意: HANKYO_YM=202609,202608（省略時は当月。JSTで1〜3日は前月も）
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'cmatch_latest.json');
const BASE = 'https://c-match.carsensor.net';

function targetMonths() {
  if (process.env.HANKYO_YM) return process.env.HANKYO_YM.split(',').map(s => s.trim()).filter(Boolean);
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const y = jst.getUTCFullYear(), m = jst.getUTCMonth() + 1, d = jst.getUTCDate();
  const ym = (yy, mm) => `${yy}${String(mm).padStart(2, '0')}`;
  const list = [ym(y, m)];
  if (d <= 3) { const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y; list.unshift(ym(py, pm)); }
  return list;
}

// ダッシュボードの cmFetchFromCmatch と同じパラメータ
function csvUrl(ym) {
  const q = new URLSearchParams({
    'frmByVehicleDto.isVehicleGraphTab': 'false', 'frmByVehicleDto.madoguchiCd': '003',
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

// リポジトリ直下を配信する小さな静的サーバー（index.html の関数を本物のまま使うため）
function serveRepo() {
  const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css' };
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0].replace(/^\//, '') || 'index.html'));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

export async function fetchCsvs(browser, months, ID, PW) {
  const ctx = await browser.newContext({ locale: 'ja-JP' });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login/`, { waitUntil: 'load' });
  await page.fill('input[name="loginId"]', ID);
  await page.fill('input[name="passwordCd"]', PW);
  await Promise.all([page.waitForLoadState('load'), page.click('input[name="doLogin"], #sbtLogin')]);
  if (/ログイン/.test(await page.title()) || /\/login/.test(page.url())) {
    throw new Error('ログインできませんでした（ID/PW、またはアクセス制限）');
  }
  const csvs = {};
  for (const ym of months) {
    // C-MATCH は月初や朝方に応答が遅いことがある。120秒待ち・3回まで再試行
    let res = null, lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        res = await ctx.request.get(csvUrl(ym), { timeout: 120000 });
        if (res.ok()) break;
        lastErr = new Error(`HTTP ${res.status()}`);
      } catch (e) { lastErr = e; }
      console.log(`CSV ${ym}: ${attempt}回目失敗（${lastErr && lastErr.message ? lastErr.message.split('\n')[0] : lastErr}）`);
      res = null;
      await new Promise(r => setTimeout(r, 15000 * attempt));
    }
    if (!res) throw new Error(`CSV取得に失敗 ${ym}: ${lastErr && lastErr.message ? lastErr.message.split('\n')[0] : lastErr}`);
    const text = decodeSjis(await res.body());
    if (!/期間指定：/.test(text.slice(0, 4000))) throw new Error(`CSVの形式が想定と違う ${ym}`);
    // 月初などで閲覧がまだ全車0の月は取り込まない（ダッシュボードが空の月を開いてしまうのを防ぐ）
    const hasViews = text.split('\n').some(l => { const c = l.split(','); return c[18] && c[18].includes('詳細閲覧数') && parseInt((c[19] || '').replace(/"/g, '')) > 0; });
    if (!hasViews) { console.log(`CSV ${ym}: 閲覧がまだ無いので今回は見送り`); continue; }
    csvs[ym] = text;
    console.log(`CSV ${ym}: ${text.length} 文字`);
  }
  await ctx.close();
  return csvs;
}

// ダッシュボード本体の関数で取り込み、cmatch_latest.json を書き出す
export async function ingest(browser, csvs, { minRows = 50 } = {}) {
  const { srv, port } = await serveRepo();
  const ctx2 = await browser.newContext();
  const dash = await ctx2.newPage();
  dash.on('dialog', d => d.dismiss().catch(() => {}));
  await dash.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await dash.waitForFunction(() => typeof window.cmIngestText === 'function' && typeof window.cmExportJson === 'function');
  await dash.evaluate(async () => { await cmLoadShared(); });   // 既存の cmatch_latest.json を土台にする
  const before = await dash.evaluate(() => cmMonths());
  const results = [];
  for (const ym of Object.keys(csvs)) {
    const r = await dash.evaluate(t => cmIngestText(t), csvs[ym]);
    results.push(r);
    console.log(`取込 ${r.ym}: ${r.rows}台 出力 ${r.exported} ${r.updated ? '(上書き)' : '(新規)'}`);
  }
  const json = await dash.evaluate(() => cmExportJson());
  const obj = JSON.parse(json);
  const after = Object.keys(obj.months).sort();
  for (const r of results) {
    const mo = obj.months[r.ym];
    if (!mo || !mo.rows || mo.rows.length < minRows) throw new Error(`取込結果が不自然（${r.ym}: ${mo ? mo.rows.length : 0}台）`);
  }
  fs.writeFileSync(OUT, json);
  console.log(`cmatch_latest.json 更新: ${(json.length / 1024).toFixed(0)}KB, 月: ${before.join(',')} → ${after.join(',')}`);
  srv.close();
  await ctx2.close();
  return { before, after, results };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const ID = process.env.CMATCH_ID, PW = process.env.CMATCH_PW;
  if (!ID || !PW) { console.error('CMATCH_ID / CMATCH_PW が未設定'); process.exit(2); }
  const months = targetMonths();
  console.log('対象月:', months.join(', '));
  const browser = await chromium.launch();
  try {
    const csvs = await fetchCsvs(browser, months, ID, PW);
    await ingest(browser, csvs);
  } finally { await browser.close(); }
}
