/* ═══════════════════════════════════════════════════════════
   INDIO 市場データ収集スクリプト
   使い方：www.carsensor.net のタブを開いて、このファイルの中身を
           そのページのコンソール（またはjavascript_tool）で eval する。
           window.MKJOB.run() で開始、window.MKJOB.status() で進捗、
           完了後 window.MKJOB.result() で JSON 文字列が取れる。
   ═══════════════════════════════════════════════════════════ */
(function(){
const CODES = {"NI/s012":"セレナ","HO/s083":"フリード","TO/s077":"シエンタ","TO/s021":"ヴォクシー","TO/s234":"エスクァイア","TO/s108":"ノア","TO/s200":"ヴェルファイア","HO/s003":"ステップワゴン","MI/s089":"デリカD5","MA/s101":"CX-30","MA/s087":"CX-5","ME/s029":"Gクラス","TO/s147":"RAV4","LE/s008":"RX","HO/s114":"ZRV","SB/s045":"インプレッサXV","HO/s101":"ヴェゼルHV現行","NI/s020":"エクストレイル","TO/s254":"カローラクロス","SZ/s011":"ジムニーシエラ","TO/s114":"ハリアー","SB/s011":"フォレスター","TO/s251":"ヤリスクロス","TO/s247":"ライズ","NI/s008":"ノート","TO/s122":"プリウス","TO/s018":"ヴィッツ","DA/s074":"トール","TO/s228":"アクア","TO/s240":"ルーミー","MI/s062":"ミラージュ","NI/s188":"オーラ","TO/s245":"カローラツーリング","SB/s048":"インプレッサスポーツ","TO/s109":"パッソ","TO/s243":"カローラスポーツ","LE/s015":"RC","SZ/s014":"ソリオバンディット","TO/s249":"ヤリス","MA/s003":"AZワゴン","MI/s109":"EKスペース","HO/s094":"N-BOX","HO/s098":"N-ONE","HO/s100":"NWGN","SZ/s001":"アルト","DA/s069":"ウェイク","SZ/s005":"エブリー","DA/s071":"キャスト","SZ/s049":"スペーシア","DA/s055":"タフト","DA/s006":"タント","NI/s179":"デイズ","NI/s181":"デイズルークス","DA/s042":"ハイゼット","DA/s032":"ハイゼットカーゴ","SZ/s050":"ハスラー","TO/s227":"ピクシスバン","DA/s065":"ミライース","DA/s011":"ミラジーノ","NI/s162":"ルークス","SZ/s015":"ワゴンＲ","DA/s012":"ムーヴ","SZ/s034":"キャリトラック","SZ/s002":"アルトラパン","MI/s002":"アウトランダー","TO/s152":"ランドクルーザープラド","TO/s239":"タンク","MA/s094":"CX-8","SB/s057":"XV","TO/s009":"アルファード","TO/s269":"ランドクルーザー250","SB/s018":"レガシィアウトバック"};
const GEN = {"SZ/s001":[["F001",198809,199410],["F002",199411,199809],["F003",199810,200408],["F004",200409,200911],["F005",200912,201411],["F006",201412,202111],["F007",202112,999912]],"SZ/s002":[["F001",200201,200810],["F002",200811,201505],["F003",201506,999912]],"SZ/s005":[["F001",198905,199108],["F002",199109,199812],["F003",199901,200507],["F004",200508,201501],["F005",201502,999912]],"SZ/s034":[["F001",198503,199108],["F002",199109,199812],["F003",199901,201308],["F004",201309,999912]],"SZ/s011":[["F001",199305,200112],["F002",200201,201806],["F003",201807,999912]],"SZ/s049":[["F001",201303,201711],["F002",201712,202310],["F003",202311,999912]],"SZ/s014":[["F001",200508,201012],["F002",201101,201507],["F003",201508,202011],["F004",202012,999912]],"SZ/s050":[["F001",201401,201911],["F002",201912,999912]],"SZ/s015":[["F001",199309,199809],["F002",199810,200308],["F003",200309,200808],["F004",200809,201208],["F005",201209,201701],["F006",201702,999912]],"SB/s045":[["F001",201006,201209],["F002",201210,999912]],"SB/s048":[["F001",201112,201609],["F002",201610,999912]],"SB/s011":[["F001",199702,200201],["F002",200202,200711],["F003",200712,201210],["F004",201211,201806],["F005",201807,202503],["F006",202504,999912]],"DA/s069":[["F004",201411,999912]],"DA/s071":[["F003",201509,999912]],"DA/s055":[["F001",197408,202005],["F002",202006,999912]],"DA/s006":[["F001",200311,200711],["F002",200712,201309],["F003",201310,201906],["F004",201907,999912]],"DA/s074":[["F004",201611,999912]],"DA/s032":[["F001",199901,200411],["F002",200412,202111],["F003",202112,999912]],"DA/s065":[["F001",201109,201704],["F002",201705,999912]],"DA/s011":[["F001",199903,200410],["F002",200411,999912]],"DA/s012":[["F001",199508,199809],["F002",199810,200209],["F003",200210,200609],["F004",200610,201011],["F005",201012,201411],["F006",201412,202505],["F007",202506,999912]],"TO/s147":[["F001",199405,200004],["F002",200005,200510],["F003",200511,201903],["F004",201904,202511],["F005",202512,999912]],"TO/s228":[["F001",201112,202106],["F002",202107,999912]],"TO/s234":[["F006",201410,999912]],"TO/s254":[["F005",202109,999912]],"TO/s243":[["F006",201806,999912]],"TO/s245":[["F005",201909,999912]],"TO/s077":[["F001",200309,201506],["F002",201507,202207],["F003",202208,999912]],"TO/s108":[["F001",200111,200705],["F002",200706,201312],["F003",201401,202111],["F004",202112,999912]],"TO/s114":[["F001",199712,200301],["F002",200302,201311],["F003",201312,202005],["F004",202006,999912]],"TO/s109":[["F001",200406,201001],["F002",201002,201603],["F003",201604,999912]],"TO/s227":[["F001",201112,202111],["F002",202112,999912]],"TO/s122":[["F001",199712,200308],["F002",200309,200904],["F003",200905,201511],["F004",201512,202211],["F005",202212,999912]],"TO/s249":[["F005",202002,999912]],"TO/s251":[["F003",202008,999912]],"TO/s247":[["F003",201911,999912]],"TO/s240":[["F004",201611,999912]],"TO/s018":[["F001",199901,200501],["F002",200502,201011],["F003",201012,999912]],"TO/s200":[["F001",200805,201412],["F002",201501,202305],["F003",202306,999912]],"TO/s021":[["F001",200111,200705],["F002",200706,201312],["F003",201401,202111],["F004",202112,999912]],"HO/s094":[["F001",201112,201708],["F002",201709,202309],["F003",202310,999912]],"HO/s098":[["F001",201211,202010],["F002",202011,999912]],"HO/s100":[["F001",201311,201907],["F002",201908,999912]],"HO/s114":[["F006",202211,999912]],"HO/s003":[["F001",199605,200103],["F002",200104,200504],["F003",200505,200909],["F004",200910,201503],["F005",201504,202204],["F006",202205,999912]],"HO/s083":[["F001",200805,201608],["F002",201609,202405],["F003",202406,999912]],"HO/s101":[["F001",201312,202103],["F002",202104,999912]],"MA/s003":[["F001",199409,199809],["F002",199810,200309],["F003",200310,200808],["F004",200809,999912]],"MA/s101":[["F003",201910,999912]],"MA/s087":[["F001",201202,201611],["F002",201612,202604],["F003",202605,999912]],"ME/s029":[["F001",199001,201805],["F002",201806,999912]],"LE/s015":[["F003",201410,999912]],"LE/s008":[["F001",200901,201509],["F002",201510,202210],["F003",202211,999912]],"MI/s109":[["F001",201402,202002],["F002",202003,202509],["F003",202510,999912]],"MI/s089":[["F004",200701,999912]],"MI/s062":[["F001",199110,199509],["F002",199510,201207],["F003",201208,999912]],"NI/s020":[["F001",200010,200707],["F002",200708,201311],["F003",201312,202206],["F004",202207,999912]],"NI/s012":[["F001",199405,199905],["F002",199906,200504],["F003",200505,201010],["F004",201011,201607],["F005",201608,202211],["F006",202212,999912]],"NI/s179":[["F001",201306,201902],["F002",201903,999912]],"NI/s181":[["F004",201402,999912]],"NI/s008":[["F001",200501,201208],["F002",201209,202011],["F003",202012,999912]],"NI/s188":[["F003",202108,999912]],"NI/s162":[["F001",200912,202002],["F002",202003,202509],["F003",202510,999912]]};
/* 世代（フルモデルチェンジ）マスタ。code → [[Fコード, 開始YYYYMM, 終了YYYYMM], ...]
   年式だけでは、モデルチェンジのあった年の掲載が新旧どちらか分からない。
   その年だけ FMCC（世代の絞り込み）を付けて取り直し、1台ずつ世代を確定させる。 */
const AREAS = [['北陸甲信越','7'],['東海','3']];
const PREV_URL = 'https://raw.githubusercontent.com/beri1212-japan/inventory-dashboard/main/market_latest.json';
const HVRE=/ハイブリッド|HYBRID|E-Four|eFour|PHEV|プラグイン|e\s*-?\s*POWER|e\s*[:：-]?\s*HEV/i;
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
const S={phase:'idle',scanned:0,pages:0,totalPages:0,cars:0,rows:0,err:0,cur:'',t0:0,finished:false,genPages:0,ambPairs:0,genTagged:0,genUnknown:0};
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
  /* ═══ 世代の確定 ═══
     年式で一意に決まる掲載はその場で確定。
     モデルチェンジ年だけ FMCC を付けて取り直し、ID→世代の対応を作る。 */
  S.phase='gen';
  const AMB=[];
  Object.keys(OUT).forEach(function(code){
    const gs=GEN[code]; if(!gs)return;
    const yrs={};
    OUT[code].rows.forEach(function(l){const y=+l.split('\t')[4]; if(y>1990)yrs[y]=1;});
    Object.keys(yrs).forEach(function(ys){
      const y=+ys;
      const hit=gs.filter(function(g){return y>=Math.floor(g[1]/100)&&y<=Math.floor(g[2]/100);});
      if(hit.length>=2)AMB.push({code:code,y:y,gens:hit.map(function(g){return g[0];})});
    });
  });
  S.ambPairs=AMB.length;
  const GMAP={};                       // id → Fコード
  for(const a of AMB){
    for(const f of a.gens){
      const fm=a.code.replace('/','_').toUpperCase()+'_'+f;
      for(const ar of AREAS){
        for(let pg=1;pg<=20;pg++){
          S.cur='世代確定 '+CODES[a.code]+' '+a.y+' '+f+' p'+pg;
          const c2=a.code.split('/');
          const u='https://www.carsensor.net/usedcar/b'+c2[0]+'/'+c2[1]+'/index'+(pg>1?pg:'')+'.html'
                 +'?AR='+ar[1]+'&YMIN='+a.y+'&YMAX='+a.y+'&FMCC='+fm;
          const h=await get(u);
          if(!h)break;
          const ids=[];
          const re2=/detail\/([A-Z0-9]+)/g; let m2;
          while((m2=re2.exec(h)))if(ids.indexOf(m2[1])<0)ids.push(m2[1]);
          ids.forEach(function(id){GMAP[id]=f;});
          S.genPages++;
          await new Promise(function(r){setTimeout(r,330);});
          if(ids.length<30)break;
        }
      }
    }
  }
  // 行に世代を付ける（曖昧年はGMAP、それ以外は年から一意に決まる）
  let tagged=0,unk=0;
  Object.keys(OUT).forEach(function(code){
    const gs=GEN[code];
    OUT[code].rows=OUT[code].rows.map(function(l){
      const p=l.split('\t'), y=+p[4], id=p[1];
      let f='';
      if(gs&&y>1990){
        const hit=gs.filter(function(g){return y>=Math.floor(g[1]/100)&&y<=Math.floor(g[2]/100);});
        if(hit.length===1)f=hit[0][0];
        else if(hit.length>=2)f=GMAP[id]||'';
      }
      if(f)tagged++;else unk++;
      return l+'\t'+f;
    });
  });
  S.genTagged=tagged; S.genUnknown=unk;

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
    fields:['area','id','total','base','year','km','color','pref','fix','wd4','hv','grade','gen'],
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
