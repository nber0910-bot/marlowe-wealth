
'use strict';

const KEY='marlowe_wealth_v2';

const initial=[
  ['009816','009816','tw','TWD',1205,19015],
  ['00646','元大 S&P500','tw','TWD',281,22016],
  ['VOO','VOO','us','USD',0.06109,43.04],
  ['FUBON_SP500','富邦標普500','fund','TWD',3307.47,36700],
  ['FUBON_NASDAQ100','富邦 NASDAQ-100','fund','TWD',2705.29,31000],
  ['YUANTA_NEW','元大新主流','fund','TWD',133.5,24800],
  ['YUANTA_DIV','元大台灣高股息優質龍頭','fund','TWD',212.8,7539]
];

const seed=()=>({
  version:2,
  assets:initial.map(([id,name,type,currency,qty,cost])=>({
    id,name,type,currency,qty,cost,verified:false
  })),
  trades:[],
  manual:{},
  fxOverride:null
});

let state;
try{
  state=JSON.parse(localStorage.getItem(KEY))||seed();
}catch{
  state=seed();
}

let feed={prices:{},fx:null,updated_at:null};

const save=()=>localStorage.setItem(KEY,JSON.stringify(state));
const money=(n,c='TWD')=>
  Number.isFinite(n)?
  new Intl.NumberFormat('zh-TW',{
    style:'currency',
    currency:c,
    maximumFractionDigits:2
  }).format(n):'待估值';

const num=n=>Number(n);
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;',
  '<':'&lt;',
  '>':'&gt;',
  '"':'&quot;',
  "'":'&#39;'
}[c]));

function fx(){
  let v=num(state.fxOverride??feed.fx?.value);
  return v>0?v:null;
}

function price(a){
  return state.manual[a.id]||feed.prices?.[a.id]||null;
}

function position(a){
  let q=num(a.qty)||0;
  let c=num(a.cost)||0;

  const trades=state.trades
    .filter(t=>t.asset===a.id)
    .sort((x,y)=>
      x.date.localeCompare(y.date)||x.created-y.created
    );

  for(const t of trades){
    if(t.side==='buy'){
      q+=t.qty;
      c+=t.qty*t.price+t.fee;
    }else{
      if(t.qty>q+1e-8)continue;
      const avg=q>0?c/q:0;
      c-=avg*t.qty;
      q-=t.qty;

      if(Math.abs(q)<1e-8){
        q=0;
        c=0;
      }
    }
  }

  return {q,c};
}

function valuation(a){
  const {q,c}=position(a);
  const p=price(a);
  const rate=a.currency==='USD'?fx():1;
  const valid=q>0&&p&&num(p.value)>0&&rate>0;

  return {
    q,c,p,
    value:valid?q*num(p.value)*rate:null,
    costTwd:
      a.currency==='USD'&&rate?c*rate:
      a.currency==='TWD'?c:null
  };
}

function render(){
  let totals={tw:0,us:0,fund:0};
  let counts={tw:0,us:0,fund:0};
  let v=0,c=0,covered=0,all=0;

  for(const a of state.assets){
    const z=valuation(a);
    if(z.q<=0)continue;

    all++;

    if(z.value!==null){
      totals[a.type]+=z.value;
      counts[a.type]++;
      v+=z.value;
      covered++;

      if(z.costTwd!==null)c+=z.costTwd;
    }
  }

  document.getElementById('total').textContent=
    covered?money(v):'尚無可估值資產';

  document.getElementById('pnl').textContent=
    covered&&c>0?
    '可估值部位未實現損益 '+money(v-c)+
    '（'+((v/c-1)*100).toFixed(2)+'%）':
    '損益待確認';

  document.getElementById('pnl').className=
    covered&&v-c<0?'negative':'positive';

  document.getElementById('coverage').textContent=
    `已估值 ${covered}/${all} 檔；未估值部位不計入總額。`+
    `美元成本以目前匯率換算，非實際匯兌損益。期初成本待核對。`;

  for(const [k,id] of [
    ['tw','twtotal'],
    ['us','ustotal'],
    ['fund','fundtotal']
  ]){
    document.getElementById(id).textContent=
      counts[k]?money(totals[k]):'待估值';
  }

  document.getElementById('count').textContent=
    covered+' / '+all;

  document.getElementById('progresslabel').textContent=
    covered?`${(v/300000*100).toFixed(1)}%（部分估值）`:'—';

  document.getElementById('progress').style.width=
    Math.min(100,v/300000*100)+'%';

  document.getElementById('marketinfo').innerHTML=
    state.assets.map(a=>{
      let z=valuation(a);

      return `<div class="item">
        <div class="between">
          <b>${safe(a.name)}</b>
          <small>${z.p?safe(z.p.date||'日期未知'):'缺少價格'}</small>
        </div>
        <small>${
          z.p?
          money(num(z.p.value),a.currency)+
          ' / 單位 · '+safe(z.p.source||'手動'):
          '無法估值'
        }${a.currency==='USD'&&!fx()?' · 缺 USD/TWD':''}</small>
      </div>`;
    }).join('');

  document.getElementById('holdlist').innerHTML=
    state.assets.map(a=>{
      const z=valuation(a);

      return `<div class="item">
        <div class="between">
          <b>${safe(a.name)}</b>
          <small>${
            a.type==='fund'?'基金':
            a.type==='us'?'美股':'台股'
          }</small>
        </div>

        <p class="muted">
          ${safe(a.id)} · ${z.q.toFixed(5)} 單位 ·
          成本 ${money(z.c,a.currency)}
        </p>

        <div class="between">
          <b>${money(z.value)}</b>
          <small>${
            z.value!==null&&z.costTwd!==null?
            money(z.value-z.costTwd):
            '損益待確認'
          }</small>
        </div>

        <small>
          ${z.p?'報價 '+safe(z.p.date||'未知'):'尚未取得價格'}
          · ${a.verified?'已核對':'期初成本待核對'}
        </small>

        <details>
          <summary>校正期初持倉</summary>
          <label>期初數量
            <input type="number" step="any"
              id="q-${safe(a.id)}" value="${a.qty}">
          </label>
          <label>期初總成本（${a.currency}）
            <input type="number" step="any"
              id="c-${safe(a.id)}" value="${a.cost}">
          </label>
          <button onclick="updateBase('${safe(a.id)}')">
            儲存校正
          </button>
          <p class="hint">
            此處只改期初基準，不會清除後續交易。
          </p>
        </details>
      </div>`;
    }).join('');

  for(const id of ['tradeasset','manualasset']){
    document.getElementById(id).innerHTML=
      state.assets.map(a=>
        `<option value="${safe(a.id)}">${safe(a.name)}</option>`
      ).join('');
  }

  document.getElementById('recordlist').innerHTML=
    state.trades.length?
    state.trades.slice().reverse().map(t=>
      `<div class="item">
        <div class="between">
          <b>${safe(t.asset)} · ${
            t.side==='buy'?'買入':'賣出'
          }</b>
          <button class="secondary"
            onclick="deleteTrade(${t.created})">刪除</button>
        </div>
        <small>
          ${safe(t.date)} · ${t.qty} × ${t.price}
          · 費用 ${t.fee}
        </small>
      </div>`
    ).join(''):
    '尚無新增交易';

  document.getElementById('feeddate').textContent=
    feed.updated_at?
    '行情檔更新：'+feed.updated_at:
    '尚未取得自動行情';

  document.getElementById('feedstatus').textContent=
    feed.updated_at?'行情已讀取':'行情未就緒';
}

function updateBase(id){
  const a=state.assets.find(x=>x.id===id);
  const q=num(document.getElementById('q-'+id).value);
  const c=num(document.getElementById('c-'+id).value);

  if(!a||!Number.isFinite(q)||q<0||
     !Number.isFinite(c)||c<0){
    return alert('請填入有效數值');
  }

  a.qty=q;
  a.cost=c;
  a.verified=true;
  save();
  render();
}

function showAddAsset(){
  document.getElementById('assetform')
    .classList.toggle('hidden');
}

function addAsset(){
  const id=document.getElementById('asymbol')
    .value.trim().toUpperCase();

  if(!id||state.assets.some(a=>a.id===id)){
    return alert('代碼空白或已存在');
  }

  state.assets.push({
    id,
    name:document.getElementById('aname').value.trim()||id,
    type:document.getElementById('atype').value,
    currency:document.getElementById('acurrency').value,
    qty:0,
    cost:0,
    verified:true
  });

  save();
  render();
  showAddAsset();
}

function addTrade(){
  const asset=document.getElementById('tradeasset').value;
  const side=document.getElementById('tradeside').value;
  const date=document.getElementById('tradedate').value;
  const qty=num(document.getElementById('tradeqty').value);
  const price=num(document.getElementById('tradeprice').value);
  const fee=num(document.getElementById('tradefee').value||0);

  if(!date||!(qty>0)||!(price>0)||fee<0){
    return alert('請填入完整有效的交易資料');
  }

  if(side==='sell'&&qty>
    position(state.assets.find(a=>a.id===asset)).q+1e-8){
    return alert('賣出數量超過持倉');
  }

  state.trades.push({
    asset,side,date,qty,price,fee,created:Date.now()
  });

  save();
  render();
  alert('交易已儲存');
}

function deleteTrade(created){
  if(!confirm('確定刪除這筆交易？'))return;

  state.trades=state.trades.filter(
    t=>t.created!==created
  );

  save();
  render();
}

function saveManual(){
  const id=document.getElementById('manualasset').value;
  const value=num(document.getElementById('manualprice').value);
  const date=document.getElementById('manualdate').value;

  if(!(value>0)||!date){
    return alert('請填價格與日期');
  }

  state.manual[id]={
    value,date,source:'手動輸入'
  };

  save();
  render();
}

function clearManual(){
  delete state.manual[
    document.getElementById('manualasset').value
  ];
  save();
  render();
}

function saveFx(){
  const raw=document.getElementById('fx').value;
  state.fxOverride=raw===''?null:num(raw);

  if(state.fxOverride!==null&&!(state.fxOverride>0)){
    return alert('匯率必須大於 0');
  }

  save();
  render();
}

function exportData(){
  const blob=new Blob([
    JSON.stringify({
      exported_at:new Date().toISOString(),
      ...state
    },null,2)
  ],{type:'application/json'});

  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=
    'wealth-v2-backup-'+
    new Date().toISOString().slice(0,10)+'.json';
  a.click();

  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function importData(e){
  const file=e.target.files?.[0];
  if(!file)return;

  try{
    const x=JSON.parse(await file.text());

    if(x.version!==2||
       !Array.isArray(x.assets)||
       !Array.isArray(x.trades)){
      throw Error('非 V2 備份');
    }

    if(!confirm('確定覆蓋目前 V2 資料？請先備份。')){
      return;
    }

    state=x;
    save();
    render();
  }catch(err){
    alert('匯入失敗：'+err.message);
  }
}

function resetDemo(){
  if(!confirm(
    '這會清除目前 V2 的持倉與交易，確定嗎？'
  ))return;

  state={
    version:2,
    assets:[],
    trades:[],
    manual:{},
    fxOverride:null
  };

  save();
  render();
}

async function loadFeed(bust=false){
  try{
    const r=await fetch(
      'market.json'+(bust?'?t='+Date.now():''),
      {cache:'no-store'}
    );

    if(!r.ok){
      throw Error('行情檔尚未建立');
    }

    const j=await r.json();

    if(!j||typeof j.prices!=='object'){
      throw Error('行情格式不正確');
    }

    feed=j;
    render();

    window.dispatchEvent(
      new Event('wealth:feed-loaded')
    );

  }catch(e){
    render();
    document.getElementById('feedstatus').textContent=
      '行情未就緒';
    document.getElementById('feeddate').textContent=
      e.message;
  }
}

document.querySelectorAll('[data-tab]').forEach(
  b=>b.addEventListener('click',()=>{
    document.querySelectorAll('main>section')
      .forEach(s=>s.classList.toggle(
        'hidden',s.id!==b.dataset.tab
      ));

    document.querySelectorAll('[data-tab]')
      .forEach(x=>x.classList.toggle(
        'active',x===b
      ));

    window.scrollTo(0,0);
  })
);

document.getElementById('tradedate').value=
  new Date().toLocaleDateString('en-CA');

document.getElementById('manualdate').value=
  new Date().toLocaleDateString('en-CA');

try{
  render();
  loadFeed();
}catch(e){
  document.getElementById('feedstatus').textContent=
    '程式錯誤：'+e.message;

  alert('WEALTH 啟動失敗：'+e.message);
}
