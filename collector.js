/* ═══════════════════════════════════════════════════════════
   INDIO 市場データ収集スクリプト
   使い方：www.carsensor.net のタブを開いて、このファイルの中身を
           そのページのコンソール（またはjavascript_tool）で eval する。
           window.MKJOB.run() で開始、window.MKJOB.status() で進捗、
           完了後 window.MKJOB.result() で JSON 文字列が取れる。
   ═══════════════════════════════════════════════════════════ */
(function(){
const CODES = {"NI/s012":"セレナ","HO/s083":"フリード","TO/s077":"シエンタ","TO/s021":"ヴォクシー","TO/s234":"エスクァイア","TO/s108":"ノア","TO/s200":"ヴェルファイア","HO/s003":"ステップワゴン","MI/s089":"デリカD5","MA/s101":"CX-30","MA/s087":"CX-5","ME/s029":"Gクラス","TO/s147":"RAV4","LE/s008":"RX","HO/s114":"ZRV","SB/s045":"インプレッサXV","HO/s101":"ヴェゼルHV現行","NI/s020":"エクストレイル","TO/s254":"カローラクロス","SZ/s011":"ジムニーシエラ","TO/s114":"ハリアー","SB/s011":"フォレスター","TO/s251":"ヤリスクロス","TO/s247":"ライズ","NI/s008":"ノート","TO/s122":"プリウス","TO/s018":"ヴィッツ","DA/s074":"トール","TO/s228":"アクア","TO/s240":"ルーミー","MI/s062":"ミラージュ","NI/s188":"オーラ","TO/s245":"カローラツーリング","SB/s048":"インプレッサスポーツ","TO/s109":"パッソ","TO/s243":"カローラスポーツ","LE/s015":"RC","SZ/s014":"ソリオバンディット","TO/s249":"ヤリス","MA/s003":"AZワゴン","MI/s109":"EKスペース","HO/s094":"N-BOX","HO/s098":"N-ONE","HO/s100":"NWGN","SZ/s001":"アルト","DA/s069":"ウェイク","SZ/s005":"エブリー","DA/s071":"キャスト","SZ/s049":"スペーシア","DA/s055":"タフト","DA/s006":"タント","NI/s179":"デイズ","NI/s181":"デイズルークス","DA/s042":"ハイゼット","DA/s032":"ハイゼットカーゴ","SZ/s050":"ハスラー","TO/s227":"ピクシスバン","DA/s065":"ミライース","DA/s011":"ミラジーノ","NI/s162":"ルークス","SZ/s015":"ワゴンＲ","DA/s012":"ムーヴ","SZ/s034":"キャリトラック","SZ/s002":"アルトラパン","MI/s002":"アウトランダー","TO/s152":"ランドクルーザープラド","TO/s239":"タンク","MA/s094":"CX-8","SB/s057":"XV","TO/s009":"アルファード","TO/s269":"ランドクルーザー250","SB/s018":"レガシィアウトバック"};
const AREAS = [['北陸甲信越','7'],['東海','3']];
const PREV_URL = 'https://raw.githubusercontent.com/beri1212-japan/inventory-dashboard/main/market_latest.json';
const HVRE=/ハイブリッド|HYBRID|E-Four|eFour|PHEV|プラグイン|e-POWER/i;
const W4RE=/4WD|４ＷＤ|4駆|E-Four|eFour/i;
const url=(code,ar,pg)=>{const c=code.split('/');return 'https://www.carsensor.net/usedcar/b'+c[0]+'/'+c[1]+'/index'+(pg>1?pg:'')+'.html?AR='+ar;};
function normColor(t){
  if(!t)return '';
  const s=String(t).replace(/\s/g,'').replace(/真珠|パール|メタリック|マイカ|クリスタル|オパール|マット|ソリッド|[ⅠⅡⅢⅣⅤIVX0-9]/g,'');
  const K=[['白',/白|ホワイト/],['黒',/黒|ブラック/],['銀',/銀|シルバー/],['灰',/灰|グレー|ガンメタ/],['青',/青|ブルー|紺/],['赤',/赤|レッド|臙脂/],['茶',/茶|ブラウン|ベージュ|ゴールド|金/],['緑',/緑|グリーン/],['黄',/黄|イエロー/],['橙',/橙|オレンジ/],['紫',/紫|パープル/],['桃',/桃|ピンク/]];
  let best=null,bi=1e9;
  K.forEach(function(kv){const m=s.match(kv[1]);if(m&&m.index<bi){bi=m.index;best=kv[0];}});
  return best||(s?'他':'');
}
function parsePage(html,areaName){
  const doc=new DOMParser().parseFromString(html,'text/html');
  const out=[];
  doc.querySelectorAll('.cassette').forEach(function(c){
    const a=c.querySelector('a[href*="/usedcar/detail/"]');
    const idm=a&&a.getAttribute('href').match(/detail\/([A-Z0-9]+)/);
    if(!idm)return;
    const g=function(sel){const e=c.querySelector(sel);return e?e.textContent.replace(/[^\d.]/g,''):'';};
    const base=(g('.basePrice__mainPriceNum')+g('.basePrice__subPriceNum'))||'';
    const tot =(g('.totalPrice__mainPriceNum')+g('.totalPrice__subPriceNum'))||'';
    const sp=[].map.call(c.querySelectorAll('.specList__data'),function(x){return x.textContent.replace(/\s+/g,'');});
    const ym=(sp[0]||'').match(/(19|20)\d{2}/);
    const kmm=(sp[1]||'').match(/([\d.]+)万/);
    const pref=(((c.querySelector('.cassetteSub__area')||{}).textContent)||'').replace(/\s+/g,'').match(/(..[都道府県]|東京都|北海道)/);
    const tip=[].filter.call(c.querySelectorAll('.carBodyInfoList__item'),function(x){return x.querySelector('.cassetteColorTip');})[0];
    const title=(((c.querySelector('.cassetteMain__title')||{}).textContent)||'')+' '+sp.join(' ');
    const gname=(((c.querySelector('.cassetteMain__title')||{}).textContent)||'').replace(/\s+/g,' ').trim().slice(0,28).replace(/\t/g,' ');
    out.push([areaName,idm[1],tot,base,ym?ym[0]:'',kmm?kmm[1]:'',normColor(tip?tip.textContent:''),pref?pref[1]:'',
      sp.some(function(x){return /修復歴あり/.test(x);})?'1':'0',
      W4RE.test(title)?'1':'0', HVRE.test(title)?'1':'0', gname].join('\t'));
  });
  return out;
}
const S={phase:'idle',scanned:0,pages:0,totalPages:0,cars:0,rows:0,err:0,cur:'',t0:0,finished:false};
const OUT={}; let SCAN={}; let PREV=null; let JSONOUT='';
async function get(u){
  for(let a=0;a<3;a++){
    try{const r=await fetch(u);if(!r.ok)throw new Error(r.status);return await r.text();}
    catch(e){await new Promise(function(r){setTimeout(r,1200*(a+1));});}
  }
  S.err++; return null;
}
async function run(){
  S.t0=Date.now(); S.phase='scan';
  for(const code of Object.keys(CODES)){
    for(const ar of AREAS){
      const h=await get(url(code,ar[1],1));
      let s=0; if(h){const re=/\{[^{}]*?"count"\s*:\s*(\d+)[^{}]*?\}/g;let m;while((m=re.exec(h)))s+=+m[1];}
      SCAN[code+'|'+ar[0]]=s; S.scanned++;
      await new Promise(function(r){setTimeout(r,250);});
    }
  }
  S.totalPages=Object.keys(SCAN).reduce(function(a,k){return a+Math.ceil(SCAN[k]/30);},0);
  S.phase='collect';
  for(const code of Object.keys(CODES)){
    const seen={},rows=[];
    for(const ar of AREAS){
      const maxp=Math.min(400,Math.ceil((SCAN[code+'|'+ar[0]]||0)/30));
      for(let pg=1;pg<=maxp;pg++){
        S.cur=CODES[code]+' '+ar[0]+' p'+pg+'/'+maxp;
        const h=await get(url(code,ar[1],pg));
        if(h)parsePage(h,ar[0]).forEach(function(l){const id=l.split('\t')[1];if(!seen[id]){seen[id]=1;rows.push(l);}});
        S.pages++;
        await new Promise(function(r){setTimeout(r,330);});
      }
    }
    OUT[code]={name:CODES[code],rows:rows};
    S.cars++; S.rows+=rows.length;
  }
  S.phase='diff';
  try{ PREV=await fetch(PREV_URL,{cache:'no-cache'}).then(function(r){return r.ok?r.json():null;}); }catch(e){ PREV=null; }
  const d=new Date();
  const ymd=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  let gone=0,fresh=0;
  if(PREV&&PREV.cars){
    Object.keys(OUT).forEach(function(code){
      const pc=PREV.cars[code]; if(!pc)return;
      const now={}; OUT[code].rows.forEach(function(l){now[l.split('\t')[1]]=1;});
      const old={}; pc.rows.forEach(function(l){old[l.split('\t')[1]]=1;});
      OUT[code].gone=pc.rows.filter(function(l){return !now[l.split('\t')[1]];});
      OUT[code].newCount=OUT[code].rows.filter(function(l){return !old[l.split('\t')[1]];}).length;
      gone+=OUT[code].gone.length; fresh+=OUT[code].newCount;
    });
  }
  JSONOUT=JSON.stringify({collected:ymd, prev:PREV?PREV.collected:null,
    areas:['北陸甲信越(AR=7)','東海(AR=3)'],
    fields:['area','id','total','base','year','km','color','pref','fix','wd4','hv','grade'],
    summary:{cars:S.cars,rows:S.rows,gone:gone,newly:fresh},
    cars:OUT});
  S.gone=gone; S.newly=fresh; S.bytes=JSONOUT.length;
  S.phase='done'; S.finished=true;
  return S;
}
window.MKJOB={
  run:run,
  status:function(){const o={};Object.keys(S).forEach(function(k){o[k]=S[k];});
    o.secs=S.t0?Math.round((Date.now()-S.t0)/1000):0;
    o.etaMin=(S.phase==='collect'&&S.pages)?Math.round((S.totalPages-S.pages)*(Date.now()-S.t0)/S.pages/1000/60):null;
    return o;},
  result:function(){return JSONOUT;},
  codes:CODES
};
return 'MKJOB ready: '+Object.keys(CODES).length+' cars';
})()
