// カーセンサー掲載の相場データ（market_latest.json）を collector.js で自動収集する。
// 価格アラート／市場マップの「市場の中央値」の元データ。
//   ・ブラウザ（Playwright）で www.carsensor.net を開き、リポジトリの collector.js をそのまま流し込んで
//     window.MKJOB.run() を走らせる（手でコンソールに貼っていた作業と同じ）
//   ・終わったら結果を market_latest.json に書く。件数が少なすぎるときは書かない（壊れたデータで上書きしない）
//   任意: MARKET_FORCE=1 … 第1・第3月曜以外でも実行する（手動実行用）
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.env.MARKET_OUT || 'market_latest.json';
const COLLECTOR = process.env.MARKET_COLLECTOR || 'collector.js';
const MIN_CARS = +(process.env.MARKET_MIN_CARS || 60);     // 72車種のうち最低これだけ取れていること
const MIN_ROWS = +(process.env.MARKET_MIN_ROWS || 30000);  // 普段は6万件前後

/** 第1・第3月曜（JST）だけ true。手動実行（MARKET_FORCE=1）は常に true */
export function shouldRun(env = process.env, now = Date.now()) {
  if (env.MARKET_FORCE === '1') return true;
  const jst = new Date(now + 9 * 3600 * 1000);
  const dow = jst.getUTCDay(), dom = jst.getUTCDate();
  return dow === 1 && ((dom >= 1 && dom <= 7) || (dom >= 15 && dom <= 21));
}

async function collect() {
  const src = fs.readFileSync(COLLECTOR, 'utf8');
  const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
  try {
    const ctx = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' });
    const page = await ctx.newPage();
    const res = await page.goto(process.env.MARKET_URL || 'https://www.carsensor.net/usedcar/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (!res || !res.ok()) throw new Error(`カーセンサーを開けませんでした HTTP ${res ? res.status() : '?'}`);
    const ready = await page.evaluate(src);
    console.log(String(ready));
    if (!/MKJOB ready/.test(String(ready))) throw new Error('collector.js の読み込みに失敗');
    await page.evaluate(() => { window.__mkErr = null; window.MKJOB.run().catch(e => { window.__mkErr = String(e && e.stack || e); }); });

    let last = '';
    const t0 = Date.now();
    for (;;) {
      await page.waitForTimeout(30000);
      const s = await page.evaluate(() => ({ st: window.MKJOB.status(), err: window.__mkErr }));
      if (s.err) throw new Error('収集中にエラー: ' + s.err);
      const st = s.st;
      const line = `${st.phase} ${st.cur || ''} pages ${st.pages}/${st.totalPages} cars ${st.cars} rows ${st.rows} err ${st.err} ${Math.round((Date.now() - t0) / 60000)}分`;
      if (line !== last) { console.log(line); last = line; }
      if (st.finished) break;
      if (Date.now() - t0 > 150 * 60000) throw new Error('150分たっても終わらないので中断');
    }
    const json = await page.evaluate(() => window.MKJOB.result());
    return json;
  } finally { await browser.close(); }
}

async function main() {
  if (!shouldRun()) { console.log('今日は第1・第3月曜ではないので何もしません'); return; }
  const json = await collect();
  const d = JSON.parse(json);
  const cars = Object.keys(d.cars || {}).length;
  const rows = d.summary ? d.summary.rows : 0;
  console.log(`収集: ${d.collected} / ${cars}車種 / ${rows}件 / 消し込み ${d.summary && d.summary.gone} / 新規 ${d.summary && d.summary.newly} / 取得エラー回数 ${d.summary && d.summary.err || 0}`);
  if (cars < MIN_CARS || rows < MIN_ROWS)
    throw new Error(`件数が少なすぎるので書き出しません（${cars}車種 / ${rows}件。目安 ${MIN_CARS}車種 / ${MIN_ROWS}件以上）。カーセンサー側でブロックされている可能性があります`);
  fs.writeFileSync(OUT, json);
  console.log(`書き出し: ${OUT}（${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)} MB）`);
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) main().catch(e => { console.error(e.message || e); process.exit(1); });
