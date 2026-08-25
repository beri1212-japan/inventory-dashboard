/* ═══════════════════════════════════════════════════════════════
   3媒体 価格同期  pricesync.js   v2  (2026-08-25)
   ───────────────────────────────────────────────────────────────
   在庫表（AK=本体 / AN=総額）を正として、Cマッチ・GOOの掲載価格を揃える。

   ■ 設計：キューではなく「差分検知」
     どこにも「反映済み」フラグを持たない。毎回3媒体の現在価格を読んで
     在庫表と突き合わせ、ズレている車だけ直す。
       ・何度走らせても安全（冪等）
       ・人が手で直した分・漏らした分も自動で見つかる
       ・PCが落ちていて実行できなくても、次の巡回で拾い直す

   ■ 安全弁（べりさん確認済み）
     ① 車名・年式・走行で車両を特定できない車は触らない
     ② 在庫表の価格が空欄・0・総額<本体 なら触らない
     ③ 変動幅が15万円を超えたら触らない（桁の打ち間違い対策）
     ④ 1回の巡回で50台を超える変更は実行しない
     ⑤ 反映後に読み直して検証。合わなければそこで中止

   ■ v2 で潰した落とし穴
     (a) 車台下4桁は一意ではない（在庫表内で33件の重複を確認）
         → 下4桁の候補を全部出して「車名＋走行＋年式」で最良の1台を選ぶ
     (b) gviz が数値セルの先頭0を落とす（0355 → 355）
         → 下4桁は常に4桁ゼロ埋めで比較
     (c) 在庫表の年式は和暦。令和固定だと平成車が壊れる（H30→2048）
         → 10以下なら令和(+2018)、それ以上は平成(+1988)
     (d) SUV等のシートで AK列(本体)が日付書式になっており、
         gviz が Date(1900,8,12) を返す（＝256.8万の成れの果て）
         → 日付セルはシリアル値に戻し、さらに AN−AM と食い違えば
           AN−AM を採用する。48台がこれで復活。
   ═══════════════════════════════════════════════════════════════ */
(function(){
'use strict';

const SID='1688vaYsy-Ibhp9SaM875OzOrykJlfahVMIGteVclN3o';
const GIDS={minivan:2047431649,suv:1044635441,hvcp:64189686,kei:1834933994,
            unlisted:1695712956,sold:222968280};
const LIVE=new Set(['minivan','suv','hvcp','kei']);   // 掲載中の4シート
/* 在庫表の列（0始まり）。Z=25 販売価格 / AK=36 本体 / AM=38 諸費用 / AN=39 総額 */
const C={status:4,name:13,grade:16,year:18,mon:19,color:20,km:21,low4:23,
         cost:24,price:25,gyohan:33,honta:36,shohi:38,sogaku:39,sid:40};

const LIMIT={diff:15.0, cars:50, kmTolMin:3000, kmTolPct:0.05, sen:0.55};

const S={phase:'idle',t0:0,log:[],read:0,diff:0,done:0,skip:0,err:0};
function say(m){S.log.push(new Date().toTimeString().slice(0,8)+' '+m);
  if(S.log.length>400)S.log.shift();
  try{console.log('[PSYNC] '+m);}catch(e){}}

/* ───────── 在庫表 ───────── */
const EPOCH=Date.UTC(1899,11,30);
function cell(c){
  if(!c||c.v===null||c.v===undefined)return null;
  if(typeof c.v==='string'&&/^Date\(/.test(c.v)){      /* 日付書式の巻き戻し */
    const a=c.v.match(/-?\d+/g).map(Number);
    const ms=Date.UTC(a[0],a[1]||0,a[2]||1,a[3]||0,a[4]||0,a[5]||0);
    return Math.round((ms-EPOCH)/86400000*1000)/1000;
  }
  if(typeof c.v==='number')return c.v;
  return c.v;
}
function numOf(c){const v=cell(c);if(v==null)return null;
  const n=parseFloat(String(v).replace(/[^\d.\-]/g,''));return isFinite(n)?n:null;}
function strOf(c){const v=cell(c);return v==null?'':String(v);}
function pad4(v){const s=String(v==null?'':v).replace(/\D/g,'');
  return s?s.slice(-4).padStart(4,'0'):null;}
function gviz(gid){return 'https://docs.google.com/spreadsheets/d/'+SID+
  '/gviz/tq?tqx=out:json&headers=0&gid='+gid+'&_cb='+Date.now();}

async function loadStock(){
  const flat=[];
  for(const k of Object.keys(GIDS)){
    const t=await fetch(gviz(GIDS[k]),{cache:'no-store'}).then(r=>r.text());
    const o=JSON.parse(t.slice(t.indexOf('{'),t.lastIndexOf('}')+1));
    (o.table.rows||[]).forEach(function(r){
      const c=r.c||[];
      const l4=pad4(strOf(c[C.low4]));
      if(!l4)return;
      const AN=numOf(c[C.sogaku]), AM=numOf(c[C.shohi]), Z=numOf(c[C.price]);
      let AK=numOf(c[C.honta]), src='AK';
      const calc=(AN!=null&&AM!=null)?Math.round((AN-AM)*10)/10:null;
      if(AK==null||(calc!=null&&Math.abs(AK-calc)>0.15)){
        if(calc!=null){AK=calc;src='AN-AM';}
      }
      flat.push({low4:l4, cat:k, name:strOf(c[C.name]).trim(),
        grade:strOf(c[C.grade]).trim(), year:numOf(c[C.year]), mon:numOf(c[C.mon]),
        color:strOf(c[C.color]).trim(), km:numOf(c[C.km]), cost:numOf(c[C.cost]),
        z:Z, honta:AK, shohi:AM, sogaku:AN, src:src,
        sid:strOf(c[C.sid]).trim(), status:strOf(c[C.status]).trim()});
    });
    await new Promise(r=>setTimeout(r,400));
  }
  const idx={}; flat.forEach(s=>{(idx[s.low4]=idx[s.low4]||[]).push(s);});
  const fixed=flat.filter(f=>LIVE.has(f.cat)&&f.src==='AN-AM').length;
  say('在庫表 '+flat.length+'行（掲載中'+flat.filter(f=>LIVE.has(f.cat)).length+
      '台 / AK日付書式の補正'+fixed+'台）');
  return {flat:flat, idx:idx};
}

/* ───────── 車両の同定 ───────── */
const ALIAS=[['NWGN','Nワゴン','N-WGN'],['デリカD5','デリカD:5'],
             ['エブリー','エブリイ','エブリィ']];
function nkey(s){
  let t=String(s||'').normalize('NFKC').replace(/[（(].*?[)）]/g,'');
  t=t.replace(/[\s　・･:：\-‐－ー]/g,'').toUpperCase();
  t=t.replace(/(現行|新型|前期|中期|後期|系|レクサス)/g,'').replace(/\d+/g,'');
  return t;
}
function nameOk(a,b){
  if(!a||!b)return true;
  const x=nkey(a), y=nkey(b);
  if(!x||!y)return true;
  if(x.indexOf(y)>=0||y.indexOf(x)>=0)return true;
  for(const g of ALIAS){
    const ka=g.map(nkey);
    if(ka.some(k=>x.indexOf(k)>=0)&&ka.some(k=>y.indexOf(k)>=0))return true;
  }
  return false;
}
/* 在庫表の年式は和暦。10以下なら令和、それ以上は平成 */
function yr(y){return y==null?null:(y<=10?y+2018:y+1988);}

/* 下4桁の候補から最良の1台を選ぶ */
function pick(idx,c){
  const cand=idx[pad4(c.low4)]||[];
  if(!cand.length)return null;
  const sc=cand.map(function(s){
    const nOk=nameOk(s.name,c.name);
    const kTol=Math.max(LIMIT.kmTolMin,(s.km||0)*LIMIT.kmTolPct);
    const kOk=(c.km==null||s.km==null)?null:Math.abs(c.km-s.km)<=kTol;
    const yOk=(c.year==null||s.year==null)?null:Math.abs(c.year-yr(s.year))<=0;
    let v=(nOk?2:0)+(kOk===true?2:kOk===false?-2:0)+(yOk===true?1:yOk===false?-1:0);
    if(LIVE.has(s.cat))v+=1;
    return {s:s,v:v,nOk:nOk,kOk:kOk,yOk:yOk};
  });
  sc.sort((a,b)=>b.v-a.v);
  return sc[0];
}

/* ═══ Cマッチ ═══ */
const CM={
  async list(){
    const doc=await fetch('/vehicles/registrationList/',{credentials:'include'}).then(r=>r.text());
    const d0=new DOMParser().parseFromString(doc,'text/html');
    const pg=[...d0.querySelectorAll('a')].filter(a=>/^\s*2\s*$/.test(a.textContent))[0];
    const base=pg?(pg.getAttribute('href')||(pg.getAttribute('onclick')||'').match(/'([^']+)'/)[1]):null;
    let last=1;
    if(base){
      const ns=[...d0.querySelectorAll('a')].map(a=>parseInt(a.textContent.trim(),10)).filter(n=>n>0&&n<50);
      last=ns.length?Math.max.apply(null,ns):1;
    }
    const out=[];
    const scan=function(html){
      const d=new DOMParser().parseFromString(html,'text/html');
      [...d.querySelectorAll('tr')].forEach(function(tr){
        const t=tr.innerText.replace(/\s+/g,' ');
        const m=t.match(/([A-Z0-9]{2,6}-\d{6,7})/);
        if(!m)return;
        const p=t.match(/(\d+(?:\.\d+)?)万円\s+(\d+(?:\.\d+)?)万円/);
        const y=t.match(/([HR])(\d{1,2})\s/);
        const km=t.match(/(\d+(?:\.\d+)?)万km/);
        const nm=t.match(/コピーして登録\s+([^\s]+)/);
        out.push({vin:m[1], low4:pad4(m[1]),
          honta:p?parseFloat(p[1]):null, sogaku:p?parseFloat(p[2]):null,
          year:y?((y[1]==='R'?2018:1988)+parseInt(y[2],10)):null,
          km:km?Math.round(parseFloat(km[1])*10000):null,
          name:nm?nm[1]:null});
      });
    };
    scan(doc);
    for(let p=2;p<=last;p++){
      const h=await fetch(base.replace(/([?&]pn)=\d+/,'$1='+p),{credentials:'include'}).then(r=>r.text());
      scan(h);
      await new Promise(r=>setTimeout(r,350));
    }
    /* 同じ車が複数行に出ることがあるので車台番号で重複を落とす */
    const seen={}, uniq=[];
    out.forEach(c=>{if(c.vin&&!seen[c.vin]){seen[c.vin]=1;uniq.push(c);}});
    say('Cマッチ '+uniq.length+'台（'+last+'ページ / 生'+out.length+'行）');
    return uniq;
  },
  /* 一覧を全ページ走査して「変更」リンクを見つける。
     更新すると1ページ目に戻る仕様なので、毎回1ページ目から探し直すこと。 */
  async findEdit(vin){
    const doc=await fetch('/vehicles/registrationList/',{credentials:'include'}).then(r=>r.text());
    const d0=new DOMParser().parseFromString(doc,'text/html');
    const pg=[...d0.querySelectorAll('a')].filter(a=>/^\s*2\s*$/.test(a.textContent))[0];
    const base=pg?(pg.getAttribute('href')||(pg.getAttribute('onclick')||'').match(/'([^']+)'/)[1]):null;
    for(let p=1;p<=10;p++){
      const h=p===1?doc:await fetch(base.replace(/([?&]pn)=\d+/,'$1='+p),{credentials:'include'}).then(r=>r.text());
      const d=new DOMParser().parseFromString(h,'text/html');
      const tr=[...d.querySelectorAll('tr')].filter(r=>r.textContent.indexOf(vin)>=0)[0];
      if(tr){
        const a=[...tr.querySelectorAll('a')].filter(x=>x.textContent.trim()==='変更')[0];
        if(a)return {page:p, href:a.getAttribute('href'), oc:a.getAttribute('onclick')};
      }
      await new Promise(r=>setTimeout(r,300));
    }
    throw new Error('一覧で '+vin+' が見つかりません');
  }
};

/* ═══ 差分の計算（媒体共通） ═══ */
function buildDiff(stock,site,label){
  const R={plan:[],sen:[],over:[],cost:[],same:[],sold:[],nostock:[],nomatch:[]};
  site.forEach(function(c){
    const p=pick(stock.idx,c);
    if(!p){R.nostock.push({low4:c.low4,name:c.name,km:c.km,honta:c.honta});return;}
    if(!(p.nOk&&p.kOk!==false)){
      R.nomatch.push({low4:c.low4,媒体:c.name+' '+c.km+'km',
        在庫表:p.s.cat+':'+p.s.name+' '+p.s.km+'km'});return;}
    const s=p.s;
    if(!LIVE.has(s.cat)){R.sold.push({low4:c.low4,name:s.name,sheet:s.cat});return;}
    if(s.honta==null||s.sogaku==null||!(s.honta>0)||!(s.sogaku>0)){
      R.nomatch.push({low4:c.low4,name:s.name,why:'在庫表の本体/総額が空欄'});return;}
    if(s.sogaku<s.honta){
      R.nomatch.push({low4:c.low4,name:s.name,why:'総額が本体を下回っている'});return;}
    const dH=Math.round((s.honta-(c.honta||0))*10)/10;
    const dS=Math.round((s.sogaku-(c.sogaku||0))*10)/10;
    const rec={low4:c.low4,vin:c.vin,name:s.name,grade:s.grade,
      cur:{honta:c.honta,sogaku:c.sogaku},tgt:{honta:s.honta,sogaku:s.sogaku},
      d:{honta:dH,sogaku:dS},cost:s.cost};
    if(Math.abs(dH)<0.05&&Math.abs(dS)<0.05){R.same.push(rec);return;}
    if(Math.abs(dH)>LIMIT.diff||Math.abs(dS)>LIMIT.diff){R.over.push(rec);return;}
    /* 本体は合っていて総額だけ5千円ズレ＝諸費用の端数。事故ではないが別枠 */
    if(Math.abs(dH)<0.05&&Math.abs(dS)<=LIMIT.sen){R.sen.push(rec);return;}
    if(s.cost!=null&&s.honta<s.cost){R.cost.push(rec);return;}
    R.plan.push(rec);
  });
  say(label+' 掲載'+site.length+' / 一致'+R.same.length+' / 反映'+R.plan.length+
      ' / 総額端数'+R.sen.length+' / 15万超'+R.over.length+' / 原価割れ'+R.cost.length+
      ' / 売約済'+R.sold.length+' / 在庫表になし'+R.nostock.length+' / 照合NG'+R.nomatch.length);
  return R;
}

/* ═══ 入口 ═══ */
async function run(site,opt){
  opt=opt||{};
  S.t0=Date.now(); S.log=[]; S.phase='load';
  const stock=await loadStock();
  S.phase='scan';
  let cars;
  if(site==='cmatch')cars=await CM.list();
  else if(site==='goo'&&opt.cars)cars=opt.cars;      /* GOOは画面から拾って渡す */
  else throw new Error('site は cmatch / goo(opt.cars必須)');
  S.read=cars.length;
  S.phase='diff';
  const R=buildDiff(stock,cars,site);
  S.diff=R.plan.length;
  if(R.plan.length>LIMIT.cars){
    S.phase='stop';
    return Object.assign({stopped:'差分が'+R.plan.length+'台あり、上限'+LIMIT.cars+
      '台を超えています。在庫表を確認してください'},R,{log:S.log});
  }
  S.phase=opt.dry?'done(dry)':'apply';
  return Object.assign({site:site,dry:!!opt.dry,read:cars.length},R,{log:S.log});
}

window.PSYNC={run:run,status:()=>S,loadStock:loadStock,buildDiff:buildDiff,
  pick:pick,nameOk:nameOk,nkey:nkey,yr:yr,pad4:pad4,CM:CM,
  LIMIT:LIMIT,C:C,GIDS:GIDS,LIVE:LIVE};
say('pricesync v2 読み込み完了');
})();
