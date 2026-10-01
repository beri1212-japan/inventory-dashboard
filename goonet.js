/* ═══════════ 反響分析（グーネット／MOTORGATE） ═══════════
   MOTORGATE「効果分析 > 店舗」の日別データを表示する。
   ・データは goonet_latest.json（GitHub Actions が自動更新）を起動時に読む
   ・手動でも「効果分析（店舗）」CSV（集計単位：日ごと）を読み込める
   ・C-matchと違い物件別ではなく店舗全体の日別なので、在庫との突合はしない
   ・index.html には <script src="goonet.js"></script> を1行足すだけで動く（ページ・ナビは自分で差し込む） */
(function(){
'use strict';
const GN_KEY='goonet_v1';
const GN_FILE='goonet_latest.json';
/* GN = { months:{ '202609':{ym,shop,savedAt,days:{ '1':{項目:値,...}, ... }}, ... }, cur:'202609' } */
let GN=null;
const GN_VIEW={metric:'front',cmp:true};

/* 指標の定義。MOTORGATEの画面とCSVで表記が少し違っても拾えるように正規表現で引く */
const GN_DEF=[
  {k:'front', re:/^正面画像表示/,                 label:'正面画像表示（詳細閲覧）', color:'#0559d2', tile:true},
  {k:'img',   re:/^複数画像表示/,                 label:'複数画像表示',           color:'#6d28d9', tile:true},
  {k:'est',   re:/^見積依頼件数$/,                label:'見積依頼'},
  {k:'resv',  re:/^予約申込/,                     label:'予約申込'},
  {k:'tel',   re:/^電話件数/,                     label:'電話（コールトラッカー）'},
  {k:'fav',   re:/検討中リスト|お気に入り/,        label:'検討中リスト追加',        color:'#b45309', tile:true},
  {k:'pw',    re:/^価格変更お知らせ/,             label:'価格変更お知らせ登録'},
  {k:'cond',  re:/車両状態評価書/,                label:'車両状態評価書表示'},
  {k:'video', re:/動画再生/,                      label:'動画再生'},
  {k:'shop',  re:/^店舗詳細表示回数$/,            label:'店舗詳細表示',           color:'#0f766e', tile:true},
  {k:'shopMap',    re:/店舗詳細表示回数\(MAP\)/,          label:'　└ MAP'},
  {k:'shopCamp',   re:/店舗詳細表示回数\(キャンペーン\)/,  label:'　└ キャンペーン'},
  {k:'shopCoupon', re:/店舗詳細表示回数\(来店クーポン\)/,  label:'　└ 来店クーポン'},
  {k:'shopStaff',  re:/店舗詳細表示回数\(スタッフ紹介\)/,  label:'　└ スタッフ紹介'},
  {k:'shopAfter',  re:/店舗詳細表示回数\(アフターサービス/, label:'　└ アフターサービス・保証'},
  {k:'shopShaken', re:/店舗詳細表示回数\(車検/,           label:'　└ 車検整備'},
  {k:'review',re:/ユーザーレビュー/,              label:'ユーザーレビュー表示'},
  {k:'hp',    re:/ホームページ表示/,              label:'ホームページ表示'},
  {k:'price', re:/支払総額/,                      label:'支払総額（平均・万円）', avg:true}
];
/* 問合せ合計＝見積＋予約＋電話（C-matchの「問合せ数」に相当） */
const GN_INQ={k:'inq',label:'問合せ数（見積＋予約＋電話）',color:'#047857',tile:true,parts:['est','resv','tel']};

function gnNorm(s){return String(s||'').replace(/\s+/g,'').replace(/（/g,'(').replace(/）/g,')');}
function gnMonths(){return GN?Object.keys(GN.months).sort():[];}
function gnCur(){return GN&&GN.months[GN.cur]||null;}
function gnPrevKey(){const a=gnMonths();const i=a.indexOf(GN.cur);return i>0?a[i-1]:null;}
function gnPrev(){const k=GN&&gnPrevKey();return k?GN.months[k]:null;}
function gnYmLabel(ym){return ym?`${ym.slice(0,4)}年${ym.slice(4,6)}月`:'';}
function gnDaysInMonth(ym){return new Date(+ym.slice(0,4),+ym.slice(4,6),0).getDate();}

/* 月のデータから、定義キー→実際の項目名 の対応表を作る */
function gnLabelMap(mo){
  const labels=new Set();
  Object.values(mo.days||{}).forEach(d=>Object.keys(d).forEach(l=>labels.add(l)));
  const map={};
  GN_DEF.forEach(def=>{const hit=[...labels].find(l=>def.re.test(l));if(hit)map[def.k]=hit;});
  return {map,labels:[...labels]};
}
/* 指標の日別配列（1日=index0）。inq は合成 */
function gnDaily(key,mo){
  const n=gnDaysInMonth(mo.ym);
  const {map}=gnLabelMap(mo);
  const out=[];
  for(let d=1;d<=n;d++){
    const rec=mo.days[String(d)];
    if(!rec){out.push(null);continue;}
    if(key==='inq'){out.push(GN_INQ.parts.reduce((a,k)=>a+(map[k]&&rec[map[k]]!=null?+rec[map[k]]:0),0));continue;}
    const l=map[key];
    out.push(l?(rec[l]!=null?+rec[l]:0):null);   // 項目はあるが空欄＝0（CSVは0を空で出すことがある）
  }
  return out;
}
/* その月で「数字が入っている最後の日」＝当月なら進んだ日数 */
function gnElapsed(mo){
  let last=0;
  Object.keys(mo.days).forEach(d=>{
    const rec=mo.days[d];
    if(Object.keys(rec).some(l=>!/支払総額/.test(l)&&+rec[l]>0))last=Math.max(last,+d);
  });
  return last||Object.keys(mo.days).length;
}
function gnSum(arr,upto){let t=0;arr.slice(0,upto).forEach(v=>{if(v!=null)t+=v;});return t;}
function gnAvg(arr,upto){const a=arr.slice(0,upto).filter(v=>v!=null&&v>0);return a.length?a.reduce((x,y)=>x+y,0)/a.length:0;}
function gnDef(k){return k==='inq'?GN_INQ:GN_DEF.find(d=>d.k===k);}

/* ── CSV（効果分析（店舗）・日ごと）の読み込み ── */
function gnParseCsvText(t){
  const rows=[];let row=[],cur='',q=false;
  for(let i=0;i<t.length;i++){const c=t[i];
    if(q){if(c==='"'){if(t[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=c;}
    else if(c==='"')q=true;
    else if(c===','){row.push(cur);cur='';}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&t[i+1]==='\n')i++;row.push(cur);rows.push(row);row=[];cur='';}
    else cur+=c;}
  if(cur!==''||row.length){row.push(cur);rows.push(row);}
  return rows;
}
function gnParse(text){
  const rows=gnParseCsvText(text);
  const cond=rows.find(r=>r.some(c=>/集計単位/.test(c)))||[];
  const unit=(cond.find(c=>/集計単位/.test(c))||'').split(':')[1]||'';
  if(unit&&!/日/.test(unit))throw new Error('「集計単位：日ごと」で出力したCSVを選んでください（今回は'+unit+'）');
  const shop=((cond.find(c=>/対象店舗/.test(c))||'').split(':')[1]||'').trim();
  const hi=rows.findIndex(r=>r[0]==='クライアント'&&r[1]==='日付');
  if(hi<0)throw new Error('効果分析（店舗）のCSVではないようです（見出し行が見つかりません）');
  const hdr=rows[hi].map(gnNorm);
  const months={};
  rows.slice(hi+1).forEach(r=>{
    const m=(r[1]||'').match(/(\d{4})年(\d{2})月(\d{2})日/);if(!m)return;
    const ym=m[1]+m[2], d=String(+m[3]);
    const mo=months[ym]||(months[ym]={ym,shop,savedAt:new Date().toISOString(),days:{}});
    const rec={};
    hdr.forEach((h,i)=>{if(i<2)return;const v=String(r[i]||'').replace(/[,万円]/g,'').trim();if(v==='')return;const n=+v;if(!isNaN(n))rec[h]=n;});
    mo.days[d]=rec;
  });
  if(!Object.keys(months).length)throw new Error('日別の行が見つかりません');
  return months;
}
function gnReadOne(file){
  return new Promise((res,rej)=>{
    const fr=new FileReader();
    fr.onload=()=>res(fr.result);fr.onerror=()=>rej(fr.error);
    fr.readAsText(file,'Shift_JIS');
  });
}
function gnMerge(months){
  if(!GN)GN={months:{},cur:null};
  Object.keys(months).forEach(ym=>{
    const b=months[ym], a=GN.months[ym];
    if(!a){GN.months[ym]=b;return;}
    // 日ごとに新しい方を採る（同じ月を2回読んだら上書き）
    Object.assign(a.days,b.days);
    a.savedAt=b.savedAt||a.savedAt;if(b.shop)a.shop=b.shop;
  });
  const a=gnMonths();if(a.length&&(!GN.cur||!GN.months[GN.cur]))GN.cur=a[a.length-1];
}
async function gnLoadFile(input){
  const files=[...input.files];input.value='';
  if(!files.length)return;
  let n=0,err=[];
  for(const f of files){
    try{const text=await gnReadOne(f);const months=gnParse(text);gnMerge(months);GN.cur=Object.keys(months).sort().pop();n++;}
    catch(e){err.push(`${f.name}: ${e.message}`);}
  }
  gnSave();renderGoonet();
  if(err.length)alert('読み込めなかったファイル:\n'+err.join('\n'));
}
function gnSave(){try{localStorage.setItem(GN_KEY,JSON.stringify(GN));}catch(e){}}
function gnRestore(){try{const s=localStorage.getItem(GN_KEY);if(s){GN=JSON.parse(s);if(!GN.months)GN=null;}}catch(e){GN=null;}}
async function gnLoadShared(){
  try{
    const res=await fetch(GN_FILE+'?t='+Date.now(),{cache:'no-store'});
    if(!res.ok)return false;
    const shared=await res.json();
    if(!shared||!shared.months)return false;
    if(!GN){GN={months:shared.months,cur:null};}
    else{
      Object.keys(shared.months).forEach(k=>{
        const a=GN.months[k], b=shared.months[k];
        if(!a){GN.months[k]=b;return;}
        const ta=Date.parse(a.savedAt||0)||0, tb=Date.parse(b.savedAt||0)||0;
        if(tb>=ta)GN.months[k]=b;
      });
    }
    const a=gnMonths();if(a.length)GN.cur=a[a.length-1];
    return true;
  }catch(e){return false;}
}
function gnSetMonth(k){if(GN&&GN.months[k]){GN.cur=k;gnSave();renderGoonet();}}
function gnSetMetric(k){GN_VIEW.metric=k;renderGoonet();}
function gnToggleCmp(){GN_VIEW.cmp=!GN_VIEW.cmp;renderGoonet();}
function gnDropMonth(){
  if(!GN||!GN.cur)return;
  if(!confirm(gnYmLabel(GN.cur)+' のグーネットデータをこのブラウザから消します。よろしいですか？'))return;
  delete GN.months[GN.cur];const a=gnMonths();GN.cur=a.length?a[a.length-1]:null;
  if(!a.length)GN=null;
  gnSave();renderGoonet();
}
function gnClear(){
  if(!confirm('グーネットの反響データをこのブラウザから全部消します。よろしいですか？（自動取込分は次回表示時に戻ります）'))return;
  GN=null;localStorage.removeItem(GN_KEY);renderGoonet();
}
function gnExportJson(){return GN?JSON.stringify({v:1,savedAt:new Date().toISOString(),months:GN.months}):null;}

/* ── 描画 ── */
function gnSpark(vals,w,h,color){
  if(typeof cmSpark==='function')return cmSpark(vals,w,h,color);
  return '';
}
function gnTrendSvg(cur,prev,days){
  const key=GN_VIEW.metric, def=gnDef(key);
  const a=gnDaily(key,cur), p=prev&&GN_VIEW.cmp?gnDaily(key,prev):null;
  const n=gnDaysInMonth(cur.ym);
  const W=900,H=260,L=48,R=14,T=14,B=30;
  const vals=[...a.slice(0,days),...(p?p:[])].filter(v=>v!=null);
  const max=Math.max(...vals,1);
  const x=i=>L+(n>1?i/(n-1):0)*(W-L-R);
  const y=v=>H-B-(v/max)*(H-T-B);
  const path=(arr,upto)=>{let d='';arr.slice(0,upto).forEach((v,i)=>{if(v==null)return;d+=(d?'L':'M')+x(i).toFixed(1)+' '+y(v).toFixed(1)+' ';});return d;};
  const dCur=path(a,days), dPrev=p?path(p,n):'';
  const area=dCur?dCur+`L${x(Math.min(days,n)-1).toFixed(1)} ${H-B} L${x(0)} ${H-B} Z`:'';
  const ticks=[];for(let v=0;v<=4;v++){const val=max*v/4;ticks.push(`<line x1="${L}" x2="${W-R}" y1="${y(val)}" y2="${y(val)}" stroke="#eceff3"/><text x="${L-6}" y="${y(val)+4}" text-anchor="end" font-size="10.5" fill="#8a94a0" font-family="var(--mono)">${def.avg?val.toFixed(0):Math.round(val).toLocaleString()}</text>`);}
  const xl=[];for(let d=1;d<=n;d++){if(d===1||d%5===0||(d===n&&n%5>=3))xl.push(`<text x="${x(d-1)}" y="${H-B+16}" text-anchor="middle" font-size="10.5" fill="#8a94a0" font-family="var(--mono)">${d}日</text>`);}
  window.__gnChart={a,p,days,n,L,R,W,H,T,B,x:(i)=>x(i),y:(v)=>y(v),cur:cur.ym,prev:prev?prev.ym:null,def};
  return `<svg id="gnTrendSvg" viewBox="0 0 ${W} ${H}" style="width:100%;height:260px;display:block"
     onmousemove="gnTrendHover(event)" onmouseleave="gnTrendOut()">
    <defs><linearGradient id="gng" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${def.color||'#0559d2'}" stop-opacity=".18"/><stop offset="1" stop-color="${def.color||'#0559d2'}" stop-opacity="0"/></linearGradient></defs>
    ${ticks.join('')}${xl.join('')}
    ${area?`<path d="${area}" fill="url(#gng)"/>`:''}
    ${dPrev?`<path d="${dPrev}" fill="none" stroke="#9aa5b1" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round"/>`:''}
    ${dCur?`<path d="${dCur}" fill="none" stroke="${def.color||'#0559d2'}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`:''}
    <line id="gnCross" x1="0" y1="${T}" x2="0" y2="${H-B}" stroke="#c8cfd6" stroke-width="1" stroke-dasharray="3 3" style="display:none"/>
    <circle id="gnDot" r="5" fill="#fff" stroke="${def.color||'#0559d2'}" stroke-width="2.5" style="display:none"/>
  </svg>`;
}
function gnTrendHover(e){
  const c=window.__gnChart;if(!c)return;
  const svg=e.currentTarget, rect=svg.getBoundingClientRect();
  const sx=(e.clientX-rect.left)/rect.width*c.W;
  let i=Math.round((sx-c.L)/((c.W-c.L-c.R)/(c.n-1)));i=Math.max(0,Math.min(c.n-1,i));
  const v=i<c.days?c.a[i]:null, pv=c.p?c.p[i]:null;
  const cross=svg.querySelector('#gnCross'), dot=svg.querySelector('#gnDot'), tip=document.getElementById('gnTip');
  cross.setAttribute('x1',c.x(i));cross.setAttribute('x2',c.x(i));cross.style.display='';
  if(v!=null){dot.setAttribute('cx',c.x(i));dot.setAttribute('cy',c.y(v));dot.style.display='';}else dot.style.display='none';
  if(tip){
    const fmt=x=>x==null?'—':(c.def.avg?x.toFixed(1):x.toLocaleString());
    tip.innerHTML=`<div style="font-size:11.5px;color:var(--text3)">${i+1}日</div>
      <div style="font-size:14px;font-weight:700;font-family:var(--mono)">${fmt(v)} <span style="font-size:11px;color:var(--text3);font-weight:500">${gnYmLabel(c.cur)}</span></div>
      ${c.p?`<div style="font-size:12px;color:var(--text3);font-family:var(--mono)">${fmt(pv)} <span style="font-size:11px">${gnYmLabel(c.prev)}</span></div>`:''}`;
    tip.style.display='';
    const px=c.x(i)/c.W*rect.width;
    tip.style.left=Math.min(rect.width-150,Math.max(0,px+12))+'px';
  }
}
function gnTrendOut(){
  const svg=document.getElementById('gnTrendSvg');if(!svg)return;
  ['#gnCross','#gnDot'].forEach(s=>{const el=svg.querySelector(s);if(el)el.style.display='none';});
  const tip=document.getElementById('gnTip');if(tip)tip.style.display='none';
}
function gnPct(a,b){return b>0?Math.round((a-b)/b*100):null;}
function gnPctTag(t){
  if(t==null)return '<span style="color:var(--text3)">—</span>';
  return `<span style="color:${t>=0?'#047857':'#b91c1c'};font-weight:600">${t>=0?'▲':'▼'}${Math.abs(t)}%</span>`;
}

function renderGoonet(){
  const box=document.getElementById('gnBody');if(!box)return;
  const sel=document.getElementById('gnMonth'), meta=document.getElementById('gnMeta'), help=document.getElementById('gnHelp');
  if(!GN||!gnMonths().length){
    if(meta)meta.textContent='未読込';
    if(sel){sel.innerHTML='';sel.style.display='none';}
    if(help)help.style.display='';
    box.innerHTML='<div class="sec"><div class="sec-body" style="padding:26px;text-align:center;color:var(--text3);font-size:13.2px">MOTORGATEの「効果分析（店舗）」CSV（日ごと）を読み込むと、ここにグーネットの反響が出ます。自動取込が動いていれば起動時に読み込まれます。</div></div>';
    return;
  }
  if(help)help.style.display='none';
  const cur=gnCur(), prev=gnPrev();
  const days=gnElapsed(cur), nDays=gnDaysInMonth(cur.ym);
  const partial=days<nDays;
  if(sel){
    sel.style.display='';
    sel.innerHTML=gnMonths().slice().reverse().map(k=>`<option value="${k}"${k===GN.cur?' selected':''}>${gnYmLabel(k)}</option>`).join('');
  }
  if(meta)meta.textContent=`${gnMonths().length}か月分 ／ ${cur.shop||''} ／ ${partial?days+'日まで':'月末まで'} ／ 更新 ${(cur.savedAt||'').slice(0,10)}`;
  const {map}=gnLabelMap(cur);

  const tile=(key)=>{
    const def=gnDef(key);
    const a=gnDaily(key,cur);
    const v=a.slice(0,days);
    const total=def.avg?gnAvg(a,days):gnSum(a,days);
    let trend=null,tlab='比較データなし';
    if(prev){
      const p=gnDaily(key,prev);
      const pt=def.avg?gnAvg(p,days):gnSum(p,days);
      if(pt>0){trend=gnPct(total,pt);tlab=(partial?'前月同期間 ':'前月 ')+(def.avg?pt.toFixed(1):pt.toLocaleString());}
    }
    const on=GN_VIEW.metric===key;
    return `<div class="cmtile${on?' on':''}" onclick="gnSetMetric('${key}')">
      <div class="cmtile-lbl">${def.label}</div>
      <div class="cmtile-val" style="color:${def.color}">${def.avg?total.toFixed(1):total.toLocaleString()}</div>
      <div class="cmtile-foot">
        ${gnPctTag(trend)}
        <span style="color:var(--text3);font-weight:500">${tlab}</span>
        <span style="margin-left:auto">${gnSpark(v,86,26,def.color)}</span>
      </div></div>`;
  };
  const metricDef=gnDef(GN_VIEW.metric);

  /* 指標一覧：当月（進んだ日数まで）／前月同期間／前月通月 */
  const order=['front','img','inq','est','resv','tel','fav','pw','cond','video','shop','shopMap','shopCamp','shopCoupon','shopStaff','shopAfter','shopShaken','review','hp','price'];
  const rowsAll=order.map(gnDef).filter(d=>d&&(d.k==='inq'||map[d.k]));
  const tbl=rowsAll.map(def=>{
    const a=gnDaily(def.k,cur);
    const t=def.avg?gnAvg(a,days):gnSum(a,days);
    let same=null,full=null;
    if(prev){const p=gnDaily(def.k,prev);same=def.avg?gnAvg(p,days):gnSum(p,days);full=def.avg?gnAvg(p,nDays):gnSum(p,gnDaysInMonth(prev.ym));}
    const f=x=>x==null?'—':(def.avg?x.toFixed(1):x.toLocaleString());
    const perDay=def.avg?'':(days?(t/days).toFixed(1):'—');
    const on=GN_VIEW.metric===def.k;
    return `<tr style="cursor:pointer${on?';background:var(--accent-bg)':''}" onclick="gnSetMetric('${def.k}')">
      <td style="text-align:left;padding:4px 10px;font-weight:${def.tile?700:500}">${def.label}</td>
      <td class="tcol" style="padding:4px 10px">${f(t)}</td>
      <td class="dcol" style="padding:4px 10px">${perDay}</td>
      <td class="dcol" style="padding:4px 10px">${f(same)}</td>
      <td style="padding:4px 10px">${gnPctTag(same!=null&&same>0?gnPct(t,same):null)}</td>
      <td class="dcol" style="padding:4px 10px">${partial?f(full):''}</td>
    </tr>`;
  }).join('');

  /* 日別表：主要5指標＋問合せ内訳 */
  const dcols=['front','img','inq','est','resv','tel','fav','shop','review'].filter(k=>k==='inq'||map[k]);
  const dser={};dcols.forEach(k=>dser[k]=gnDaily(k,cur));
  const dow=['日','月','火','水','木','金','土'];
  const drows=[];
  for(let d=1;d<=days;d++){
    const dt=new Date(+cur.ym.slice(0,4),+cur.ym.slice(4,6)-1,d);
    const wd=dt.getDay();
    drows.push(`<tr><td style="text-align:left;padding:3px 10px;font-family:var(--mono);color:${wd===0?'#b91c1c':wd===6?'#0559d2':'inherit'}">${d}日(${dow[wd]})</td>`+
      dcols.map(k=>{const v=dser[k][d-1];return `<td style="padding:3px 10px;font-family:var(--mono);${v?'':'color:var(--text3)'}">${v==null?'—':v.toLocaleString()}</td>`;}).join('')+'</tr>');
  }
  const dsum=`<tr style="background:var(--bg3);font-weight:700"><td style="text-align:left;padding:4px 10px">合計</td>${dcols.map(k=>`<td style="padding:4px 10px;font-family:var(--mono)">${gnSum(dser[k],days).toLocaleString()}</td>`).join('')}</tr>`;

  box.innerHTML=`
  <div class="sec" style="margin-bottom:12px">
    <div class="sec-body" style="padding:12px 14px">
      <div class="cmtiles">
        ${tile('front')}${tile('img')}${tile('inq')}${tile('fav')}${tile('shop')}
      </div>
    </div>
  </div>
  <div class="sec" style="margin-bottom:12px">
    <div class="sec-hdr" style="gap:10px;flex-wrap:wrap">
      <span class="sec-title">${metricDef.label}の推移</span>
      <span style="font-size:12.6px;color:var(--text3)">${gnYmLabel(cur.ym)} ・ 日別 ・ 店舗全体。上のタイルや下の表の行をクリックすると指標が切り替わります</span>
      <div style="margin-left:auto;display:flex;align-items:center;gap:14px;font-size:12.6px">
        <span style="display:flex;align-items:center;gap:5px"><i style="display:inline-block;width:16px;height:2px;background:${metricDef.color||'#0559d2'}"></i>${gnYmLabel(cur.ym)}</span>
        ${prev?`<label class="chklbl" style="gap:5px"><input type="checkbox" ${GN_VIEW.cmp?'checked':''} onchange="gnToggleCmp()">
          <span style="display:flex;align-items:center;gap:5px"><i style="display:inline-block;width:16px;height:0;border-top:2px dashed #9aa5b1"></i>${gnYmLabel(prev.ym)}と比較</span></label>`:''}
      </div>
    </div>
    <div class="sec-body" style="padding:8px 12px 4px">
      <div style="position:relative">${gnTrendSvg(cur,prev,days)}<div id="gnTip" class="cmtip" style="display:none"></div></div>
    </div>
  </div>
  <div class="two-col" style="align-items:start">
    <div class="sec">
      <div class="sec-hdr"><span class="sec-title">指標の一覧</span><span style="font-size:12.6px;color:var(--text3)">${partial?`1〜${days}日の合計（前月は同じ日数で比較）`:'月合計'}</span></div>
      <div class="sec-body" style="padding:0;overflow:auto">
        <table style="width:100%">
          <thead><tr>
            <th style="text-align:left;padding:4px 10px;width:auto;min-width:200px;max-width:none">指標</th>
            <th style="padding:4px 10px;width:auto;min-width:70px;max-width:none">${gnYmLabel(cur.ym)}</th>
            <th style="padding:4px 10px;width:auto;min-width:50px;max-width:none">1日あたり</th>
            <th style="padding:4px 10px;width:auto;min-width:70px;max-width:none">${prev?gnYmLabel(prev.ym):'前月'}${partial?'同期間':''}</th>
            <th style="padding:4px 10px;width:auto;min-width:56px;max-width:none">増減</th>
            <th style="padding:4px 10px;width:auto;min-width:70px;max-width:none">${partial&&prev?gnYmLabel(prev.ym)+'通月':''}</th>
          </tr></thead>
          <tbody>${tbl}</tbody>
        </table>
      </div>
    </div>
    <div class="sec">
      <div class="sec-hdr"><span class="sec-title">日別</span><span style="font-size:12.6px;color:var(--text3)">${gnYmLabel(cur.ym)}</span></div>
      <div class="sec-body" style="padding:0;overflow:auto;max-height:560px">
        <table style="width:100%">
          <thead><tr><th style="text-align:left;padding:4px 10px;width:auto;min-width:80px;max-width:none">日</th>
            ${dcols.map(k=>`<th style="padding:4px 8px;width:auto;min-width:56px;max-width:none;white-space:normal;line-height:1.2">${gnDef(k).label.replace('（詳細閲覧）','').replace('（見積＋予約＋電話）','').replace('（コールトラッカー）','')}</th>`).join('')}
          </tr></thead>
          <tbody>${drows.join('')}${dsum}</tbody>
        </table>
      </div>
    </div>
  </div>
  <div style="font-size:12.6px;color:var(--text3);padding:8px 2px">
    ※ グーネット（MOTORGATE）の効果分析は店舗全体の日別集計で、物件ごとの内訳はありません。「正面画像表示」が車両詳細ページの閲覧に相当します。
    「問合せ数」は 見積依頼＋予約申込＋電話（コールトラッカー）の合計です。
  </div>`;
}

/* ── ページとナビを index.html に差し込む ── */
function gnInstall(){
  if(document.getElementById('page-goonet'))return;
  const cmBtn=document.querySelector(`.nav-item[onclick="showPage('cmatch')"]`);
  if(cmBtn){
    const b=document.createElement('button');b.className='nav-item';b.setAttribute('onclick',"showPage('goonet')");
    b.innerHTML='<svg class="ic" aria-hidden="true"><use href="#i-chart"></use></svg><span>反響分析（グー）</span>';
    cmBtn.insertAdjacentElement('afterend',b);
    cmBtn.querySelector('span').textContent='反響分析（Cマッチ）';
  }
  const cmPage=document.getElementById('page-cmatch');
  const pg=document.createElement('div');pg.className='page';pg.id='page-goonet';
  pg.innerHTML=`
  <div class="sec" style="margin-bottom:12px">
    <div class="sec-hdr" style="gap:10px;flex-wrap:wrap">
      <span class="sec-title"><svg class="ic ic-s" aria-hidden="true"><use href="#i-chart"></use></svg>グーネット（MOTORGATE）の効果分析</span>
      <div class="ctrls">
        <label class="rbtn ghost" style="cursor:pointer;margin:0">
          <svg class="ic ic-s"><use href="#i-down"></use></svg>CSVを読み込む（複数可）
          <input type="file" id="gnFile" accept=".csv,text/csv" multiple style="display:none" onchange="gnLoadFile(this)">
        </label>
        <select class="sel" id="gnMonth" style="display:none" onchange="gnSetMonth(this.value)"></select>
        <button class="rbtn ghost" onclick="gnDropMonth()">この月を消す</button>
        <button class="rbtn ghost" onclick="gnClear()">全部消す</button>
      </div>
      <span style="margin-left:auto;font-size:12.6px;color:var(--text3)" id="gnMeta">未読込</span>
    </div>
    <div class="sec-body" style="padding:10px 14px;font-size:12.6px;color:var(--text3);line-height:1.8" id="gnHelp">
      MOTORGATE →「効果分析」→「店舗」→ 集計単位を<b>日ごと</b>にして <b>CSVダウンロード</b> したファイルをそのまま選んでください。
      自動取込（GitHub Actions）が動いていれば、読み込まなくても当月と前月が表示されます。
    </div>
  </div>
  <div id="gnBody"></div>`;
  (cmPage||document.querySelector('.page')).insertAdjacentElement('afterend',pg);
  try{PAGE_META.goonet=['反響分析（グーネット）','グーネットの閲覧・問合せを日別で見る（店舗全体）'];}catch(e){}
  const orig=window.showPage;
  if(typeof orig==='function')window.showPage=function(n){orig(n);if(n==='goonet')renderGoonet();};
}
async function gnInit(){
  gnInstall();
  gnRestore();
  await gnLoadShared();
  renderGoonet();
}
Object.assign(window,{renderGoonet,gnLoadFile,gnSetMonth,gnSetMetric,gnToggleCmp,gnDropMonth,gnClear,gnExportJson,gnTrendHover,gnTrendOut,gnParse,gnNorm});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',gnInit);else gnInit();
})();
