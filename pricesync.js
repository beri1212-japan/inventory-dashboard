/* ═══════════════════════════════════════════════════════════════
   3媒体 価格同期  pricesync.js   v3  (2026-08-26)
   ───────────────────────────────────────────────────────────────
   在庫表（AK=本体 / AN=総額）を正として、
   Cマッチ・GOO・シンフォニー の掲載価格を揃える。

   ■ 設計：キューではなく「差分検知」
     どこにも「反映済み」フラグを持たない。毎回3媒体の現在価格を読んで
     在庫表と突き合わせ、ズレている車だけ直す。
       ・何度走らせても安全（冪等）
       ・人が手で直した分・漏らした分も自動で見つかる
       ・PCが落ちていて実行できなくても、次の巡回で拾い直す

   ■ 安全弁（べりさん確認済み）
     ① 車両を特定できない車は触らない
     ② 在庫表の価格が空欄・0・総額<本体 なら触らない
     ③ 変動幅が15万円を超えたら触らない（桁の打ち間違い対策）
     ④ 反映の直前に在庫表と媒体を「両方とも取り直す」
     ⑤ 反映後に読み直して検証

   ■ v3（実戦投入 2026-08-25夜／Cマッチ51台・GOO82台を反映して確定）
     (a) 一番効いた発見：**SID（在庫表AO列）で突き合わせる**
         下4桁は在庫表の中だけで33件も重複していて危険。
         シンフォニーはSID検索が使えるので照合NGが3台まで落ちた。
         Cマッチ・GOOはSIDを持たないので下4桁＋車名＋走行＋年式で当てる。
     (b) gvizが数値セルの先頭0を落とす（0355→355）→ 常に4桁ゼロ埋め
     (c) 在庫表の年式は和暦。10以下は令和(+2018)、それ以上は平成(+1988)
     (d) SUV等のシートで AK列(本体)が日付書式になっていて
         gvizが Date(1900,8,12) を返す（＝256.8万の成れの果て）。
         日付セルはシリアル値に戻し、AN−AM と食い違えば AN−AM を採用。48台が復活。
     (e) 公開CSVは10〜40分キャッシュが効く。取り直さずに走ると
         **下げたばかりの価格を元に戻す**。実行直前の再取得は必須。
     (f) 諸費用が「.5」で終わる車は媒体側が1万に切り上げられていた（23台）。
         べりさん判断で**在庫表を正**とし、媒体を5千円下げる。
     (g) 「本体<原価」で止める安全弁は撤去した。掲載中285台の18%が該当し、
         売れた377台でも同じく18%。異常ではなく常態だった。
         見るなら **総額<原価**（11台まで減る）。

   ■ 使い方（同一オリジンでないと各サイトのデータが取れない）
     c-match.carsensor.net のタブで： await PSYNC.run('cmatch',{dry:true})
     motorgate.jp        のタブで： await PSYNC.run('goo',   {dry:true})
     kurumaerabi.com     のタブで： await PSYNC.run('symphony',{dry:true})
     dry:false で実際に反映する。
   ═══════════════════════════════════════════════════════════════ */
(function(){
'use strict';

const SID='1688vaYsy-Ibhp9SaM875OzOrykJlfahVMIGteVclN3o';
const GIDS={minivan:2047431649,suv:1044635441,hvcp:64189686,kei:1834933994,
            unlisted:1695712956,sold:222968280};
const LIVE=new Set(['minivan','suv','hvcp','kei']);
/* 在庫表の列（0始まり）。Z=25 販売価格 / AK=36 本体 / AM=38 諸費用 / AN=39 総額 / AO=40 SID */
const C={status:4,name:13,grade:16,year:18,mon:19,color:20,km:21,low4:23,
         cost:24,price:25,gyohan:33,honta:36,shohi:38,sogaku:39,sid:40};

const LIMIT={diff:15.0, kmTolMin:3000, kmTolPct:0.05};

const S={phase:'idle',log:[]};
function say(m){S.log.push(new Date().toTimeString().slice(0,8)+' '+m);
  if(S.log.length>400)S.log.shift();
  try{console.log('[PSYNC] '+m);}catch(e){}}

/* ───────── 在庫表 ───────── */
const EPOCH=Date.UTC(1899,11,30);
function cell(c){
  if(!c||c.v===null||c.v===undefined)return null;
  if(typeof c.v==='string'&&/^Date\(/.test(c.v)){     /* 日付書式の巻き戻し */
    const a=c.v.match(/-?\d+/g).map(Number);
    const ms=Date.UTC(a[0],a[1]||0,a[2]||1,a[3]||0,a[4]||0,a[5]||0);
    return Math.round((ms-EPOCH)/86400000*1000)/1000;
  }
  if(typeof c.v==='number')return c.v;
  return c.v;
}
function num(c){const v=cell(c);if(v==null)return null;
  const n=parseFloat(String(v).replace(/[^\d.\-]/g,''));return isFinite(n)?n:null;}
function str(c){const v=cell(c);return v==null?'':String(v);}
function pad4(v){const s=String(v==null?'':v).replace(/\D/g,'');
  return s?s.slice(-4).padStart(4,'0'):null;}
/* キャッシュを避けるため毎回別のクエリにして cache:'reload' で取る */
function gviz(gid){return 'https://docs.google.com/spreadsheets/d/'+SID+
  '/gviz/tq?tqx=out:json&headers=0&gid='+gid+'&_cb='+Date.now()+Math.floor(Math.random()*1e6);}

async function loadStock(){
  const flat=[];
  for(const k of Object.keys(GIDS)){
    const t=await fetch(gviz(GIDS[k]),{cache:'reload'}).then(r=>r.text());
    const o=JSON.parse(t.slice(t.indexOf('{'),t.lastIndexOf('}')+1));
    (o.table.rows||[]).forEach(function(r){
      const c=r.c||[];
      const l4=pad4(str(c[C.low4]));
      const sid=String(num(c[C.sid])||'').replace(/\D/g,'')||null;
      if(!l4&&!sid)return;
      const AN=num(c[C.sogaku]), AM=num(c[C.shohi]), Z=num(c[C.price]);
      let AK=num(c[C.honta]), src='AK';
      const calc=(AN!=null&&AM!=null)?Math.round((AN-AM)*10)/10:null;
      if(AK==null||(calc!=null&&Math.abs(AK-calc)>0.15)){
        if(calc!=null){AK=calc;src='AN-AM';}
      }
      flat.push({sid:sid, low4:l4, cat:k, name:str(c[C.name]).trim(),
        grade:str(c[C.grade]).trim(), year:num(c[C.year]), mon:num(c[C.mon]),
        color:str(c[C.color]).trim(), km:num(c[C.km]), cost:num(c[C.cost]),
        z:Z, honta:AK, shohi:AM, sogaku:AN, src:src, status:str(c[C.status]).trim()});
    });
    await new Promise(r=>setTimeout(r,350));
  }
  const byLow4={}, bySid={};
  flat.forEach(s=>{ if(s.low4)(byLow4[s.low4]=byLow4[s.low4]||[]).push(s);
                    if(s.sid)bySid[s.sid]=s; });
  const fixed=flat.filter(f=>LIVE.has(f.cat)&&f.src==='AN-AM').length;
  say('在庫表 '+flat.length+'行（掲載中'+flat.filter(f=>LIVE.has(f.cat)).length+
      '台 / SIDあり'+Object.keys(bySid).length+' / AK日付書式の補正'+fixed+'台）');
  return {flat:flat, byLow4:byLow4, bySid:bySid};
}

/* ───────── 車両の同定 ───────── */
const ALIAS=[['NWGN','Nワゴン','N-WGN'],['デリカD5','デリカD:5'],
             ['エブリー','エブリイ','エブリィ']];
function nkey(s){
  let t=String(s||'').normalize('NFKC').replace(/[（(].*?[)）]/g,'');
  t=t.replace(/[\s　・･:：\-‐－ー]/g,'').toUpperCase();
  t=t.replace(/ＨＥＶ|E:HEV|EHEV|ハイブリッド|ﾊｲﾌﾞﾘｯﾄﾞ/g,'HV');
  return t.replace(/(現行|新型|前期|中期|後期|系|レクサス)/g,'').replace(/\d+/g,'');
}
function nameOk(a,b){
  if(!a||!b)return true;
  const x=nkey(a), y=nkey(b);
  if(!x||!y)return true;
  if(x.indexOf(y)>=0||y.indexOf(x)>=0)return true;
  for(const g of ALIAS){
    const k=g.map(nkey);
    if(k.some(q=>x.indexOf(q)>=0)&&k.some(q=>y.indexOf(q)>=0))return true;
  }
  return false;
}
/* GOOの車名は「車種 グレード 装備…」なので先頭だけ使う */
function head(n){return String(n||'').trim().split(/[\s　]+/)[0];}
/* 在庫表の年式は和暦。10以下なら令和、それ以上は平成 */
function yr(y){return y==null?null:(y<=10?y+2018:y+1988);}

/* 媒体の1台 → 在庫表の1台。SIDがあればそれが最優先 */
function pick(stock,c){
  if(c.sid&&stock.bySid[c.sid]){
    const s=stock.bySid[c.sid];
    /* SIDで引けても下4桁と走行は必ず二重チェックする */
    if(c.low4&&s.low4&&pad4(c.low4)!==s.low4)
      return {s:s,ok:false,why:'下4桁 表'+s.low4+' vs 媒体'+pad4(c.low4)};
    if(c.km!=null&&s.km!=null&&Math.abs(c.km-s.km)>Math.max(LIMIT.kmTolMin,s.km*LIMIT.kmTolPct))
      return {s:s,ok:false,why:'走行 表'+s.km+' vs 媒体'+c.km};
    return {s:s,ok:true,by:'SID'};
  }
  const cand=stock.byLow4[pad4(c.low4)]||[];
  if(!cand.length)return null;
  const sc=cand.map(function(s){
    const nOk=nameOk(s.name,head(c.name));
    const kTol=Math.max(LIMIT.kmTolMin,(s.km||0)*LIMIT.kmTolPct);
    const kOk=(c.km==null||s.km==null)?null:Math.abs(c.km-s.km)<=kTol;
    const yOk=(c.year==null||s.year==null)?null:Math.abs(c.year-yr(s.year))<=0;
    let v=(nOk?2:0)+(kOk===true?2:kOk===false?-2:0)+(yOk===true?1:yOk===false?-1:0);
    if(LIVE.has(s.cat))v+=1;
    return {s:s,v:v,nOk:nOk,kOk:kOk};
  });
  sc.sort((a,b)=>b.v-a.v);
  const p=sc[0];
  return {s:p.s, ok:!!(p.nOk&&p.kOk!==false), by:'下4桁',
          why:p.nOk?'走行が合わない':'車名が合わない'};
}

/* ═══ 差分の計算（媒体共通） ═══ */
function buildDiff(stock,site,label){
  const R={plan:[],over:[],same:[],sold:[],nostock:[],nomatch:[]};
  site.forEach(function(c){
    const p=pick(stock,c);
    if(!p){R.nostock.push({low4:c.low4,name:c.name,km:c.km,honta:c.honta});return;}
    if(!p.ok){R.nomatch.push({low4:c.low4,name:c.name,why:p.why});return;}
    const s=p.s;
    if(!LIVE.has(s.cat)){R.sold.push({low4:s.low4,name:s.name,sheet:s.cat});return;}
    if(!(s.honta>0)||!(s.sogaku>0)){
      R.nomatch.push({low4:s.low4,name:s.name,why:'在庫表の本体/総額が空欄'});return;}
    if(s.sogaku<s.honta){
      R.nomatch.push({low4:s.low4,name:s.name,why:'総額が本体を下回っている'});return;}
    if(c.honta==null||c.sogaku==null)return;
    const dH=Math.round((s.honta-c.honta)*10)/10;
    const dS=Math.round((s.sogaku-c.sogaku)*10)/10;
    const rec={sid:c.sid||s.sid, key:c.key, low4:s.low4, name:s.name, grade:s.grade,
      cur:[c.honta,c.sogaku], tgt:[s.honta,s.sogaku], d:[dH,dS], by:p.by};
    if(Math.abs(dH)<0.05&&Math.abs(dS)<0.05){R.same.push(rec);return;}
    if(Math.abs(dH)>LIMIT.diff||Math.abs(dS)>LIMIT.diff){R.over.push(rec);return;}
    R.plan.push(rec);
  });
  say(label+' 掲載'+site.length+' / 一致'+R.same.length+' / 反映'+R.plan.length+
      ' / 15万超'+R.over.length+' / 売約済'+R.sold.length+
      ' / 在庫表になし'+R.nostock.length+' / 照合NG'+R.nomatch.length);
  return R;
}

/* ═══ Cマッチ ═══ */
const CM={
  async list(){
    const doc=await fetch('/vehicles/registrationList/',{credentials:'include'}).then(r=>r.text());
    const base=CM._base(doc);
    const last=CM._last(doc);
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
        out.push({key:m[1], vin:m[1], low4:pad4(m[1]),
          honta:p?parseFloat(p[1]):null, sogaku:p?parseFloat(p[2]):null,
          year:y?((y[1]==='R'?2018:1988)+parseInt(y[2],10)):null,
          km:km?Math.round(parseFloat(km[1])*10000):null,
          name:nm?nm[1]:null});
      });
    };
    scan(doc);
    for(let p=2;p<=last;p++){
      scan(await fetch(base.replace(/([?&]pn)=\d+/,'$1='+p),{credentials:'include'}).then(r=>r.text()));
      await new Promise(r=>setTimeout(r,350));
    }
    const seen={},uniq=[];
    out.forEach(c=>{if(!seen[c.vin]){seen[c.vin]=1;uniq.push(c);}});
    say('Cマッチ '+uniq.length+'台（'+last+'ページ）');
    return uniq;
  },
  _base(doc){
    const d=new DOMParser().parseFromString(doc,'text/html');
    const pg=[...d.querySelectorAll('a')].filter(a=>/^\s*2\s*$/.test(a.textContent))[0];
    return pg?(pg.getAttribute('href')||(pg.getAttribute('onclick')||'').match(/'([^']+)'/)[1]):null;
  },
  _last(doc){
    const d=new DOMParser().parseFromString(doc,'text/html');
    const ns=[...d.querySelectorAll('a')].map(a=>parseInt(a.textContent.trim(),10)).filter(n=>n>0&&n<50);
    return ns.length?Math.max.apply(null,ns):1;
  },
  /* 更新すると一覧の1ページ目に戻るので、毎回1ページ目から探し直す */
  async findEdit(vin){
    const doc=await fetch('/vehicles/registrationList/',{credentials:'include'}).then(r=>r.text());
    const base=CM._base(doc);
    for(let p=1;p<=15;p++){
      const h=p===1?doc:await fetch(base.replace(/([?&]pn)=\d+/,'$1='+p),{credentials:'include'}).then(r=>r.text());
      const d=new DOMParser().parseFromString(h,'text/html');
      const tr=[...d.querySelectorAll('tr')].filter(r=>r.textContent.indexOf(vin)>=0)[0];
      if(tr){
        const a=[...tr.querySelectorAll('a')].filter(x=>x.textContent.trim()==='変更')[0];
        if(a)return {page:p, href:a.getAttribute('href')};
      }
      await new Promise(r=>setTimeout(r,300));
    }
    return null;
  },
  /* 編集画面での入力。本体・総額とも「万」と「千」に分かれている */
  fill(tgt){
    const g=n=>document.getElementsByName(n)[0];
    const set=(n,v)=>{const e=g(n);if(!e)return null;
      const s=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set;
      s.call(e,String(v));
      ['input','change','blur'].forEach(t=>e.dispatchEvent(new Event(t,{bubbles:true})));
      return e.value;};
    const h=tgt[0],so=tgt[1];
    const hm=Math.floor(h+1e-6), hs=Math.round((h-hm)*10);
    const sm=Math.floor(so+1e-6), ss=Math.round((so-sm)*10);
    set('ksaiKakakuMan',hm);set('ksaiKakakuSen',hs);
    set('ksaiSogakuMan',sm);set('ksaiSogakuSen',ss);
    return g('ksaiKakakuMan').value+'.'+g('ksaiKakakuSen').value+' / '+
           g('ksaiSogakuMan').value+'.'+g('ksaiSogakuSen').value;
  },
  vin(){const e=document.getElementsByName('syataiNo')[0];return e?e.value:null;},
  /* 確定 → NGワードチェック → A/Bプラン確認 → 完了。
     総額が変わらない車はA/Bプラン確認を経ずに完了ページへ飛ぶ。 */
  step(){
    const p=location.pathname;
    if(/doCreate/.test(p)){
      const ok=[...document.querySelectorAll('a,input,button')]
        .filter(e=>(e.textContent||e.value||'').trim()==='OK')[0];
      if(ok){ok.click();return 'ngword-OK';}
    }
    if(/doPreConfirm/.test(p)){
      [...document.getElementsByName('sogakuHaneiRadio')].forEach(x=>{if(x.value==='1')x.checked=true;});
      const a=[...document.querySelectorAll('a')].filter(e=>/更新して/.test(e.textContent))[0];
      if(a){a.click();return 'confirm-update';}
    }
    if(CM.done())return 'done';
    return 'unknown:'+p;
  },
  done(){return /doCompleteCreate/.test(location.pathname)||/物件登録（基本プラン）完了/.test(document.title);}
};

/* ═══ GOO（MOTORGATE） ═══
   一覧ページ /stock/newsearch/stocklist/index/{ページ}/100 に
   全車の価格入力欄がそのまま出ている。ページを開いたままAJAXで1台ずつ反映できる。 */
const GOO={
  async list(){
    const cars=[];
    for(let p=1;p<=6;p++){
      const h=await fetch('/stock/newsearch/stocklist/index/'+p+'/100',{credentials:'include',cache:'reload'}).then(r=>r.text());
      const d=new DOMParser().parseFromString(h,'text/html');
      const ids=[...d.querySelectorAll('input')].map(e=>e.id||'').filter(x=>/^kakaku_input_/.test(x));
      if(!ids.length)break;
      ids.forEach(function(id){
        const gid=id.replace('kakaku_input_','');
        const el=d.getElementById(id);
        let row=el;
        for(let i=0;i<10&&row;i++){if((row.textContent||'').indexOf('車台番号')>=0)break;row=row.parentElement;}
        if(!row)return;
        const t=row.textContent.replace(/\s+/g,' ').trim();
        const vin=(t.match(/車台番号\/\s*([A-Z0-9]+-[0-9]+)/)||[])[1]||null;
        const nm=(t.match(/^\s*[\d\/]*\s*(.+?)\s+(?:掲載中|掲載停止|内容確認)/)||[])[1]||'';
        const y=(t.match(/(\d{4})年\s/)||[])[1];
        const km=(t.match(/([\d.]+)万K/)||[])[1];
        const pr=t.match(/価格\s*([\d.]+)万円\s*総額\s*([\d.]+)万円/);
        cars.push({key:gid, page:p, vin:vin, low4:pad4(vin),
          name:nm.slice(0,40), year:y?parseInt(y,10):null,
          km:km?Math.round(parseFloat(km)*10000):null,
          honta:pr?parseFloat(pr[1]):null, sogaku:pr?parseFloat(pr[2]):null});
      });
      await new Promise(r=>setTimeout(r,400));
    }
    say('GOO '+cars.length+'台');
    return cars;
  },
  /* 反映は一覧ページ上で。ローン設定のある車は confirm が出るので拾って記録する */
  async apply(rec){
    const gid=rec.key;
    const ki=document.getElementById('kakaku_input_'+gid);
    if(!ki)return {ok:false,why:'このページに無い'};
    let row=ki;
    for(let i=0;i<10&&row;i++){if((row.textContent||'').indexOf('車台番号')>=0)break;row=row.parentElement;}
    const vin=row?((row.textContent.replace(/\s+/g,' ').match(/車台番号\/\s*([A-Z0-9]+-[0-9]+)/)||[])[1]||''):'';
    if(rec.vin&&vin!==rec.vin)return {ok:false,why:'車台番号不一致 '+vin};
    let loan=false;
    const oc=window.confirm; window.confirm=function(){loan=true;return true;};
    const open=document.getElementById('price-change-button-'+gid);
    if(open)eval(open.getAttribute('onclick').replace(/^Javascript:/i,''));
    const set=(id,v)=>{const e=document.getElementById(id);if(!e)return null;
      const s=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set;
      s.call(e,String(v));
      ['input','change','blur'].forEach(t=>e.dispatchEvent(new Event(t,{bubbles:true})));
      return e.value;};
    const a=set('kakaku_input_'+gid,rec.tgt[0]);
    const b=set('total_input_'+gid,rec.tgt[1]);   /* 業販は触らない */
    if(a!=String(rec.tgt[0])||b!=String(rec.tgt[1])){window.confirm=oc;return {ok:false,why:'入力できず'};}
    ajax_change_price(gid);
    await new Promise(r=>setTimeout(r,800));
    window.confirm=oc;
    return {ok:true, loan:loan};
  }
};

/* ═══ シンフォニー ═══
   在庫車両一覧（1ページ100件）で現在価格を読む。SIDが取れるのが強み。
   反映は クイックサーチ(symp-ID) → 詳細 → 広告情報を修正 →
   input_sales_price / input_total_payment（どちらも万円単位）→ このページの内容を保存する。
   ※ 2026-08-26 時点、無人での連続反映は未完（タブが固まったため中断）。
      画面遷移がすべて /symphony/ へのPOSTで、GETのURLを持たないのが難点。 */
const SY={
  collect(){
    const out=[];
    [...document.querySelectorAll('tbody.nolinktr_white')].forEach(function(b){
      const t=b.textContent.replace(/\s+/g,' ').trim();
      const sid=(t.match(/symp-ID:(\d+)/)||[])[1];
      if(!sid)return;
      const honta=(t.match(/税込：([\d.]+)万円/)||[])[1];
      const sogaku=(t.match(/総額：([\d.]+)万円/)||[])[1];
      const km=(t.match(/走行([\d,]+)km/)||[])[1];
      const l4=(t.match(/([0-9]{3,4})\s*走行/)||[])[1];
      const y=(t.match(/(\d{4})年/)||[])[1];
      const nm=(t.match(/車両詳細へ\s*(\S+)\s+(\S+)/)||[]);
      out.push({key:sid, sid:sid, low4:pad4(l4), name:nm[2]||'',
        year:y?parseInt(y,10):null,
        km:km?parseInt(String(km).replace(/,/g,''),10):null,
        honta:honta?parseFloat(honta):null, sogaku:sogaku?parseFloat(sogaku):null});
    });
    return out;
  },
  /* 一覧を1ページ目から最後までめくって集める（100件表示にしておくこと） */
  async list(){
    let all=SY.collect();
    for(let i=0;i<10;i++){
      const nx=[...document.querySelectorAll('span')]
        .filter(e=>e.children.length===0&&e.textContent.trim()==='次へ')[0];
      if(!nx)break;
      nx.click();
      await new Promise(r=>setTimeout(r,4500));
      all=all.concat(SY.collect());
    }
    const seen={},uniq=[];
    all.forEach(c=>{if(!seen[c.sid]){seen[c.sid]=1;uniq.push(c);}});
    say('シンフォニー '+uniq.length+'台');
    return uniq;
  },
  /* 広告情報ページでの入力。万円単位でそのまま入る */
  fill(tgt){
    const set=(n,v)=>{const e=document.getElementsByName(n)[0];if(!e)return null;
      const s=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set;
      s.call(e,String(v));
      ['input','change','blur'].forEach(t=>e.dispatchEvent(new Event(t,{bubbles:true})));
      return e.value;};
    set('input_sales_price',tgt[0]);      /* 車両価格＝本体 */
    set('input_total_payment',tgt[1]);    /* 支払総額 */
    return document.getElementsByName('input_sales_price')[0].value+' / '+
           document.getElementsByName('input_total_payment')[0].value;
  },
  save(){
    const b=[...document.querySelectorAll('span.btntext_hozon')]
      .filter(e=>/このページの内容を保存する/.test(e.textContent||''))[0];
    if(!b)return false; b.click(); return true;
  },
  sid(){const m=(document.body.innerText||'').match(/symp-ID:(\d+)/);return m?m[1]:null;}
};

/* ═══ 入口 ═══ */
async function run(site,opt){
  opt=opt||{};
  S.log=[]; S.phase='load';
  const stock=await loadStock();       /* ← 実行のたびに取り直す（安全弁④） */
  S.phase='scan';
  let cars;
  if(site==='cmatch')cars=await CM.list();
  else if(site==='goo')cars=await GOO.list();
  else if(site==='symphony')cars=await SY.list();
  else throw new Error('site は cmatch / goo / symphony');
  S.phase='diff';
  const R=buildDiff(stock,cars,site);
  S.phase=opt.dry?'done(dry)':'apply';
  return Object.assign({site:site,dry:!!opt.dry,read:cars.length},R,{log:S.log});
}

window.PSYNC={run:run,status:()=>S,loadStock:loadStock,buildDiff:buildDiff,
  pick:pick,nameOk:nameOk,nkey:nkey,head:head,yr:yr,pad4:pad4,
  CM:CM,GOO:GOO,SY:SY,LIMIT:LIMIT,C:C,GIDS:GIDS,LIVE:LIVE};
say('pricesync v3 読み込み完了');
})();
