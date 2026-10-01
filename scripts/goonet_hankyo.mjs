// MOTORGATE（グーネット）「効果分析 > 店舗」の日別データを取得し、goonet_latest.json を更新する。
// ダッシュボード（index.html + goonet.js）の「反響分析（グー）」がこのファイルを読む。
//   必要な環境変数（GitHub の Secrets）:
//     MG_CLIENT_ID … MOTORGATE のクライアントID（ログイン画面の1つ目の欄）
//     MG_USER_ID   … ユーザーID（使っていなければ登録しなくてよい）
//     MG_PW        … パスワード
//   任意: GOO_YM=202609,202608 または all（画面で選べる月すべて。初回用）。省略時は当月（JSTの1〜3日は前月も）
//   任意: GOO_CSV=path.csv … MOTORGATE に行かず、手元の「効果分析（店舗）」CSV（日ごと）を取り込む
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.MG_BASE || 'https://motorgate.jp';
const OUT = process.env.GOO_OUT || 'goonet_latest.json';

export function targetMonths(env = process.env, now = Date.now()) {
  if (env.GOO_YM && env.GOO_YM !== 'all') return env.GOO_YM.split(',').map(s => s.trim()).filter(Boolean);
  if (env.GOO_YM === 'all') return ['all'];
  const jst = new Date(now + 9 * 3600 * 1000);
  const y = jst.getUTCFullYear(), m = jst.getUTCMonth() + 1, d = jst.getUTCDate();
  const ym = (yy, mm) => `${yy}${String(mm).padStart(2, '0')}`;
  const list = [ym(y, m)];
  if (d <= 3) { const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y; list.unshift(ym(py, pm)); }
  return list;
}

export const norm = s => String(s || '').replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');

/** 画面の日別表（1ページ最大13日分）を読む。{ days:[日], rows:[{label, vals:[]}] } */
async function readTable(page) {
  return page.evaluate(() => {
    const trs = [...document.querySelectorAll('tr')];
    const hdr = trs.find(tr => tr.cells.length > 5 && /\d+\s*\((月|火|水|木|金|土|日)\)/.test(tr.innerText));
    if (!hdr) return null;
    const days = [...hdr.cells].map(c => { const m = c.textContent.replace(/\s+/g, '').match(/^(\d+)\(/); return m ? Number(m[1]) : null; });
    const table = hdr.closest('table');
    const scope = table ? [...table.querySelectorAll('tr')] : trs;
    const rows = [];
    for (const tr of scope) {
      if (tr === hdr) continue;
      const cells = [...tr.cells].map(c => c.textContent.trim());
      const li = cells.findIndex(t => t && !/^[-\d.,]+(万円)?$/.test(t));
      if (li < 0) continue;
      const vals = cells.slice(li + 1);
      if (!vals.some(v => /^[-\d.,]+(万円)?$/.test(v))) continue;
      rows.push({ label: cells[li], vals });
    }
    return { days, rows };
  });
}

/** 画面から月ごとの { ym, shop, days:{ '1': {項目:値} } } を集める */
async function fetchMonths(months, env) {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await page.fill('#client_id', env.MG_CLIENT_ID);
    if (env.MG_USER_ID) await page.fill('input[name="user_id"]', env.MG_USER_ID);
    await page.fill('input[name="client_pw"]', env.MG_PW);
    await Promise.all([page.waitForLoadState('load'), page.click('#button01')]);
    await page.waitForTimeout(1500);
    if (/ログイン/.test(await page.title())) throw new Error('MOTORGATEにログインできませんでした（ID/PW、またはアクセス制限）');
    const shop = await page.$eval('body', b => (b.innerText.match(/\d{5,}\s+(.+?)\s*様/) || [])[1] || '').catch(() => '');
    console.log(`店舗: ${shop}`);

    await page.goto(`${BASE}/ana/store`, { waitUntil: 'load' });
    const avail = await page.$$eval('#PeriodSpecification option', os => os.map(o => o.value));
    const list = months[0] === 'all' ? avail : months.filter(m => avail.includes(m));
    const skipped = months.filter(m => m !== 'all' && !avail.includes(m));
    if (skipped.length) console.log(`画面で選べない月は飛ばします: ${skipped.join(', ')}（選べる月: ${avail.join(', ')}）`);

    const out = {};
    for (const ym of list) {
      const mo = { ym, shop, savedAt: new Date().toISOString(), days: {} };
      for (const start of [1, 11, 21]) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'load', timeout: 60000 }),
          page.evaluate(({ ym, start }) => {
            for (const id of ['PeriodSpecification', 'TimeDesignated']) { const s = document.getElementById(id); if (s) s.value = ym; }
            const u = document.getElementById('CountingUnit'); if (u) u.value = 'day';
            setTimeout(() => window.stor_next_day(start, 'store_from'), 30);
          }, { ym, start }),
        ]);
        await page.waitForTimeout(1500);
        const t = await readTable(page);
        if (!t) throw new Error(`日別の表が見つかりません ${ym} ${start}日～`);
        let n = 0;
        for (const r of t.rows) {
          const off = Math.max(0, t.days.length - r.vals.length);
          t.days.slice(off).forEach((d, i) => {
            if (d == null || d < start || d >= start + 10 + (start === 21 ? 2 : 0)) return;
            const v = (r.vals[i] || '').replace(/[,万円]/g, '');
            if (!/^-?\d+(\.\d+)?$/.test(v)) return;
            (mo.days[String(d)] ||= {})[norm(r.label)] = Number(v);
            n++;
          });
        }
        console.log(`${ym} ${start}日～: 項目${t.rows.length} / ${n}件`);
      }
      out[ym] = mo;
    }
    return out;
  } finally { await browser.close(); }
}

/** 手元の「効果分析（店舗）」CSV（Shift_JIS・日ごと）を読む */
export function parseCsv(buf) {
  const text = new TextDecoder('shift_jis').decode(buf);
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c; }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  const cond = rows.find(r => r.some(c => /集計単位/.test(c))) || [];
  const unit = (cond.find(c => /集計単位/.test(c)) || '').split(':')[1] || '';
  if (unit && !/日/.test(unit)) throw new Error(`集計単位が「日ごと」ではありません: ${unit}`);
  const shop = ((cond.find(c => /対象店舗/.test(c)) || '').split(':')[1] || '').trim();
  const hi = rows.findIndex(r => r[0] === 'クライアント' && r[1] === '日付');
  if (hi < 0) throw new Error('効果分析（店舗）のCSVではないようです');
  const hdr = rows[hi].map(norm);
  const out = {};
  rows.slice(hi + 1).forEach(r => {
    const m = (r[1] || '').match(/(\d{4})年(\d{2})月(\d{2})日/); if (!m) return;
    const ym = m[1] + m[2], d = String(+m[3]);
    const mo = out[ym] ||= { ym, shop, savedAt: new Date().toISOString(), days: {} };
    const rec = {};
    hdr.forEach((h, i) => { if (i < 2) return; const v = String(r[i] || '').replace(/[,万円]/g, '').trim(); if (v === '') return; const n = +v; if (!isNaN(n)) rec[h] = n; });
    mo.days[d] = rec;
  });
  return out;
}

/** 既存の goonet_latest.json に月を重ねる（同じ月は日ごとに上書き）。閲覧が0の月は見送る */
export function mergeInto(existing, months, { keepMonths = 24 } = {}) {
  const data = existing && existing.months ? existing : { v: 1, months: {} };
  for (const ym of Object.keys(months)) {
    const mo = months[ym];
    const hasViews = Object.values(mo.days).some(rec => Object.keys(rec).some(l => /正面画像|複数画像/.test(l) && rec[l] > 0));
    if (!hasViews) { console.log(`${ym}: 閲覧がまだ無いので今回は見送り`); continue; }
    const cur = data.months[ym];
    if (!cur) data.months[ym] = mo;
    else { Object.assign(cur.days, mo.days); cur.savedAt = mo.savedAt; if (mo.shop) cur.shop = mo.shop; }
  }
  const keys = Object.keys(data.months).sort();
  keys.slice(0, Math.max(0, keys.length - keepMonths)).forEach(k => delete data.months[k]);
  data.savedAt = new Date().toISOString();
  return data;
}

async function main() {
  const env = process.env;
  let months;
  if (env.GOO_CSV) {
    months = parseCsv(fs.readFileSync(env.GOO_CSV));
  } else {
    if (!env.MG_CLIENT_ID || !env.MG_PW) throw new Error('Secrets（MG_CLIENT_ID / MG_PW）が足りません');
    const target = targetMonths(env);
    console.log('対象月:', target.join(', '));
    months = await fetchMonths(target, env);
  }
  const got = Object.keys(months).sort();
  if (!got.length) { console.log('データが0件のため更新しません'); return; }
  got.forEach(ym => console.log(`${ym}: ${Object.keys(months[ym].days).length}日分`));
  let existing = null;
  try { existing = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}
  const data = mergeInto(existing, months);
  fs.writeFileSync(OUT, JSON.stringify(data));
  const n = Object.keys(data.months).length;
  console.log(`書き出し: ${OUT}（${n}か月分、${(fs.statSync(OUT).size / 1024).toFixed(1)} KB）`);
}

if (import.meta.url === `file://${path.resolve(process.argv[1])}`) main().catch(e => { console.error(e.message || e); process.exit(1); });
