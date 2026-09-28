// 南自動車の MOTORGATE（グーネット）「効果分析 > 店舗」の日別データを取得し、
// 南自動車ダッシュボード（GAS Webアプリ）へ送って統合シートの「Goo」タブを更新する。
//   必要な環境変数（GitHub の Secrets）:
//     MINAMI_MG_CLIENT_ID … 南自動車の MOTORGATE クライアントID（ログイン画面の1つ目の欄）
//     MINAMI_MG_USER_ID   … ユーザーID（使っていなければ登録しなくてよい）
//     MINAMI_MG_PW        … パスワード
//     MINAMI_GAS_URL / MINAMI_GAS_KEY … 反響と同じもの
//   任意: GOO_YM=202609,202608 または all（画面で選べる月すべて。初回用）。省略時は当月＋前月
import { chromium } from 'playwright';

const BASE = process.env.MG_BASE || 'https://motorgate.jp'; // MG_BASE はテスト用

export function targetMonths(env = process.env, now = Date.now()) {
  if (env.GOO_YM && env.GOO_YM !== 'all') return env.GOO_YM.split(',').map(s => s.trim()).filter(Boolean);
  if (env.GOO_YM === 'all') return ['all'];
  const jst = new Date(now + 9 * 3600 * 1000);
  const y = jst.getUTCFullYear(), m = jst.getUTCMonth() + 1;
  const ym = (yy, mm) => `${yy}${String(mm).padStart(2, '0')}`;
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
  return [ym(py, pm), ym(y, m)];
}

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
      const li = cells.findIndex(t => t && !/^[-\d.,]+$/.test(t));
      if (li < 0) continue;
      const vals = cells.slice(li + 1);
      if (!vals.some(v => /^[-\d.,]+$/.test(v))) continue;
      rows.push({ label: cells[li], vals });
    }
    return { days, rows };
  });
}

async function fetchAll(months, env) {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await page.fill('#client_id', env.MINAMI_MG_CLIENT_ID);
    if (env.MINAMI_MG_USER_ID) await page.fill('input[name="user_id"]', env.MINAMI_MG_USER_ID);
    await page.fill('input[name="client_pw"]', env.MINAMI_MG_PW);
    await Promise.all([page.waitForLoadState('load'), page.click('#button01')]);
    await page.waitForTimeout(1500);
    if (/ログイン/.test(await page.title())) throw new Error('MOTORGATEにログインできませんでした（ID/PW、またはアクセス制限）');
    const shop = await page.$eval('body', b => (b.innerText.match(/(\d{5,})\s+(.+?)\s*様/) || []).slice(1).join(' ')).catch(() => '');
    console.log(`店舗: ${shop}`);

    await page.goto(`${BASE}/ana/store`, { waitUntil: 'load' });
    const avail = await page.$$eval('#PeriodSpecification option', os => os.map(o => o.value));
    const list = months[0] === 'all' ? avail : months.filter(m => avail.includes(m));
    const skipped = months.filter(m => m !== 'all' && !avail.includes(m));
    if (skipped.length) console.log(`画面で選べない月は飛ばします: ${skipped.join(', ')}（選べる月: ${avail.join(', ')}）`);

    const out = []; // [日付, 項目, 値]
    for (const ym of list) {
      for (const start of [1, 11, 21]) {
        // 画面の関数でページを送り直す。送信後の読み込みが終わるまで待ってから表を読む
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
          const off = Math.max(0, t.days.length - r.vals.length); // 見出し行の先頭に空欄がある場合のずれ
          t.days.slice(off).forEach((d, i) => {
            if (d == null || d < start || d >= start + 10 + (start === 21 ? 2 : 0)) return;
            const v = (r.vals[i] || '').replace(/,/g, '');
            if (!/^-?\d+(\.\d+)?$/.test(v)) return;
            out.push([`${ym.slice(0, 4)}-${ym.slice(4, 6)}-${String(d).padStart(2, '0')}`, r.label, Number(v)]);
            n++;
          });
        }
        console.log(`${ym} ${start}日～: 項目${t.rows.length} / ${n}件`);
      }
    }
    // 同じ日・同じ項目が重なったら後のものを使う
    const m = new Map(out.map(r => [r[0] + '|' + r[1], r]));
    return [...m.values()];
  } finally { await browser.close(); }
}

async function postToGas(url, key, rows) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ key, kind: 'goo', rows }), redirect: 'follow' });
  const text = await res.text();
  let r; try { r = JSON.parse(text); } catch { throw new Error(`GASの応答が読めません HTTP ${res.status}: ${text.slice(0, 200)}`); }
  if (!r.ok) throw new Error(`GASが受け付けませんでした: ${r.error}`);
  return r;
}

async function main() {
  const env = process.env;
  if (!env.MINAMI_MG_CLIENT_ID || !env.MINAMI_MG_PW || !env.MINAMI_GAS_URL || !env.MINAMI_GAS_KEY)
    throw new Error('Secrets（MINAMI_MG_CLIENT_ID / MINAMI_MG_PW / MINAMI_GAS_URL / MINAMI_GAS_KEY）が足りません');
  const months = targetMonths(env);
  console.log('対象月:', months.join(', '));
  const rows = await fetchAll(months, env);
  if (!rows.length) { console.log('データが0件のため送信しません'); return; }
  const r = await postToGas(env.MINAMI_GAS_URL, env.MINAMI_GAS_KEY, rows);
  console.log(`送信: ${r.rows}件（${r.from}〜${r.to}）／Gooタブ合計 ${r.total}行`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.message || e); process.exit(1); });
