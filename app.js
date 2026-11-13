'use strict';
// MARLOWE WEALTH V26.1113 — history & P/L calendar extension.
// Never change this storage key: existing holdings and trades live here.
const KEY='marlowe_wealth_v2', BTC_STALE_HOURS=2;
const initial=[['009816','009816','tw','TWD',1205,19015],['00646','元大 S&P500','tw','TWD',281,22016],['VOO','VOO','us','USD',0.06109,43.04],['FUBON_SP500','富邦標普500','fund','TWD',3307.47,36700],['FUBON_NASDAQ100','富邦 NASDAQ-100','fund','TWD',2705.29,31000],['YUANTA_NEW','元大新主流','fund','TWD',133.5,24800],['YUANTA_DIV','元大台灣高股息優質龍頭','fund','TWD',212.8,7539],['BTC','Bitcoin (BTC)','crypto','TWD',0,0]];
const seed=()=>({version:2,assets:initial.map(([id,name,type,currency,qty,cost])=>({id,name,type,currency,qty,cost,verified:false})),trades:[],manual:{},fxOverride:null});
let state;
try{state=JSON.parse(localStorage.getItem(KEY))||seed();}catch{state=seed();}
if(!Array.isArray(state.assets))state.assets=[];
if(!Array.isArray(state.trades))state.trades=[];
if(!state.manual||typeof state.manual!=='object')state.manual={};
if(!state.history||typeof state.history!=='object'||Array.isArray(state.history))state.history={};
if(!Array.isArray(state.history.snapshots))state.history.snapshots=[];
// Preserve the existing one-time BTC migration. Never auto-add 00713 or VOO trades.
if(!state.assets.some(a=>a.id==='BTC'))state.assets.push({id:'BTC',name:'Bitcoin (BTC)',type:'crypto',currency:'TWD',qty:0,cost:0,verified:true});
const btcAsset=state.assets.find(a=>a.id==='BTC');
if(!(Number(btcAsset.qty)>0)&&!state.trades.some(t=>t.asset==='BTC'))state.trades.push({asset:'BTC',side:'buy',date:'2026-11-13',qty:0.0012974,price:2368360,fee:0,created:1794500000001,feeUnverified:true,note:'BitoPro BTC/TWD spot; fee pending verification'});
if(!state.manual.BTC)state.manual.BTC={value:2362249,date:'2026-11-13',source:'BitoPro 截圖參考價（非即時）'};
const save=()=>localStorage.setItem(KEY,JSON.stringify(state));
save();
let feed={prices:{},fx:null,updated_at:null},feedError=null;
const byId=id=>document.getElementById(id);
const num=n=>Number(n);
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=(n,c='TWD')=>Number.isFinite(n)?new Intl.NumberFormat('zh-TW',{style:'currency',currency:c,maximumFractionDigits:2}).format(n):'待估值';
const fmtQty=n=>Number(n).toFixed(8).replace(/0+$/,'').replace(/\.$/,'');
const today=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
const twDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dateValid=d=>/^\d{4}-\d{2}-\d{2}$/.test(String(d))&&!Number.isNaN(Date.parse(d+'T00:00:00Z'));
const closeEnough=(a,b)=>Math.abs(a-b)<1e-7;
function fx(){const v=num(state.fxOverride??feed.fx?.value);return v>0?v:null;}
function validQuote(p){return !!p&&typeof p==='object'&&p.value!==null&&p.value!==undefined&&p.value!==''&&Number.isFinite(Number(p.value))&&Number(p.value)>0;}
function validBtcFeedQuote(p){if(!validQuote(p)||p.currency!=='TWD'||p.pair!=='btc_twd')return false;const t=Date.parse(p.retrieved_at||'');return Number.isFinite(t)&&t<=Date.now()+300000;}
function btcQuote(){const p=feed.prices?.BTC;if(validBtcFeedQuote(p))return {...p,automatic:true};const m=state.manual?.BTC;return validQuote(m)?{...m,automatic:false}:null;}
function price(a){return a.id==='BTC'?btcQuote():state.manual[a.id]||feed.prices?.[a.id]||null;}
function btcQuoteStatus(){const p=btcQuote();if(!p)return {label:'無可用報價',detail:'尚未取得 BTC/TWD 價格',stale:true};if(!p.automatic)return {label:'手動參考價',detail:'目前使用手動價格，並非即時行情',stale:true};const stale=Date.now()-Date.parse(p.retrieved_at)>BTC_STALE_HOURS*3600000;return {label:stale?'行情已過期':'自動行情正常',detail:stale?'超過 2 小時未取得新報價，仍顯示最後有效價格':'BitoPro 最近一次成功取得的行情快照',stale};}
function taiwanTime(value){const t=Date.parse(value||'');return Number.isFinite(t)?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(t)):'時間未知';}
function renderBtcStatus(){const el=byId('btcPriceNote');if(!el)return;const p=btcQuote(),s=btcQuoteStatus();if(!p){el.textContent='BTC/TWD 尚無可用價格，等待 BitoPro 自動行情。';return;}el.innerHTML=`<b class="${s.stale?'negative':'positive'}">BTC · ${safe(s.label)}</b><br>${p.automatic?'BitoPro BTC/TWD':'參考價格'}：${money(Number(p.value))}<br>${p.automatic?'擷取時間：'+safe(taiwanTime(p.retrieved_at)):'參考日期：'+safe(p.date||'未知')}<br>${safe(s.detail)}`;}
function position(a){let q=num(a.qty)||0,c=num(a.cost)||0;const trades=state.trades.filter(t=>t.asset===a.id).sort((x,y)=>String(x.date).localeCompare(String(y.date))||(x.created||0)-(y.created||0));for(const t of trades){const tq=num(t.qty)||0,tp=num(t.price)||0,tf=num(t.fee)||0;if(t.side==='buy'){q+=tq;c+=tq*tp+tf;}else if(t.side==='sell'&&tq<=q+1e-8){const avg=q>0?c/q:0;c-=avg*tq;q-=tq;if(Math.abs(q)<1e-8){q=0;c=0;}}}return {q,c};}
function valuation(a){const {q,c}=position(a),p=price(a),rate=a.currency==='USD'?fx():1,valid=q>0&&validQuote(p)&&rate>0;return {q,c,p,value:valid?q*num(p.value)*rate:null,costTwd:a.currency==='USD'&&rate?c*rate:a.currency==='TWD'?c:null};}
function estimatedTrades(id){return state.trades.filter(t=>t.asset===id&&t.estimated===true);}
const CATEGORY_ORDER=['tw','us','fund','crypto'];
const CATEGORY_INFO={tw:{name:'台股 ETF',color:'#83b8ff'},us:{name:'美股 ETF',color:'#83d9c1'},fund:{name:'基金',color:'#c5a4ff'},crypto:{name:'加密貨幣',color:'#f2bd74'}};
function categoryRows(type){return state.assets.filter(a=>a.type===type).map(a=>({asset:a,...valuation(a)})).filter(z=>z.q>0);}
function renderCategoryDetails(totals){for(const type of CATEGORY_ORDER){const el=byId(type+'details');if(!el)continue;const rows=categoryRows(type);el.innerHTML=rows.length?rows.map(z=>{const a=z.asset,pnl=z.value!==null&&z.costTwd!==null?z.value-z.costTwd:null,pct=z.value!==null&&totals[type]>0?z.value/totals[type]*100:null;return `<div class="asset-detail-row"><div class="asset-detail-name">${safe(a.name)}${estimatedTrades(a.id).length?' · 🟡 預估':''}</div><div class="asset-detail-value">${z.value!==null?money(z.value):'待估值'}</div><div class="asset-detail-meta">${pnl===null?'損益待確認':`<span class="${pnl<0?'negative':'positive'}">${money(pnl)}</span>`}${pct===null?'':` · 類別占比 ${pct.toFixed(1)}%`}</div></div>`;}).join(''):'<p class="hint">目前沒有持倉</p>';}}
function renderAllocation(totals){const donut=byId('allocationDonut'),legend=byId('allocationLegend'),center=byId('allocationCenter');if(!donut||!legend||!center)return;const total=CATEGORY_ORDER.reduce((s,t)=>s+Math.max(0,totals[t]||0),0);if(!(total>0)){donut.style.background='#34465e';donut.setAttribute('aria-label','尚無可估值資產');center.textContent='待估值';legend.innerHTML='<small>尚無可估值的資產配置資料</small>';return;}let sum=0;const seg=[];for(const t of CATEGORY_ORDER){const v=Math.max(0,totals[t]||0);if(!v)continue;const start=sum/total*100;sum+=v;seg.push(`${CATEGORY_INFO[t].color} ${start.toFixed(5)}% ${(sum/total*100).toFixed(5)}%`);}donut.style.background=`conic-gradient(${seg.join(',')})`;donut.setAttribute('aria-label',CATEGORY_ORDER.map(t=>`${CATEGORY_INFO[t].name} ${((totals[t]||0)/total*100).toFixed(1)}%`).join('、'));center.textContent='100%';legend.innerHTML=CATEGORY_ORDER.map(t=>`<div class="allocation-legend-row"><span class="allocation-legend-name"><span class="allocation-dot" style="background:${CATEGORY_INFO[t].color}"></span>${CATEGORY_INFO[t].name}</span><span class="allocation-legend-value">${((totals[t]||0)/total*100).toFixed(1)}%</span></div>`).join('');}
function installAssetCardInteractions(){document.querySelectorAll('.asset-card').forEach(card=>{const toggle=()=>card.setAttribute('aria-expanded',String(card.classList.toggle('is-open')));card.addEventListener('click',toggle);card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle();}});});}

// History snapshots are observations, NOT verified exchange closes.
// Never backfill missing days or infer returns across a trade/position change.
function snapshotCandidate(){
  if(!feed.updated_at)return null;
  let value=0,cost=0,covered=0,all=0;
  const positions={}, prices={};
  for(const a of state.assets){
    const z=valuation(a);
    if(z.q<=0)continue;
    all++;
    if(z.value===null||z.costTwd===null||!validQuote(z.p))continue;
    covered++;value+=z.value;cost+=z.costTwd;
    positions[a.id]={q:z.q,c:z.c,currency:a.currency};
    prices[a.id]=Number(z.p.value);
  }
  if(!all||covered!==all||!Number.isFinite(value)||!Number.isFinite(cost))return null;
  return {date:twDate(),observedAt:new Date().toISOString(),value,cost,
    unrealized:value-cost,positions,prices,fx:fx(),coverage:covered};
}
function recordSnapshot(){
  const s=snapshotCandidate();if(!s)return;
  const arr=state.history.snapshots;
  const i=arr.findIndex(x=>x.date===s.date);
  if(i>=0)arr[i]=s;else arr.push(s);
  arr.sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  save();
}

function samePositions(a,b){if(!a||!b)return false;const ka=Object.keys(a),kb=Object.keys(b);return ka.length===kb.length&&ka.every(k=>b[k]&&closeEnough(Number(a[k].q),Number(b[k].q))&&closeEnough(Number(a[k].c),Number(b[k].c))&&a[k].currency===b[k].currency);}
function dateAfter(d){const x=new Date(d+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+1);return x.toISOString().slice(0,10);}
function dailyChanges(){
  const arr=state.history.snapshots.slice().filter(x=>dateValid(x.date))
    .sort((a,b)=>a.date.localeCompare(b.date));
  const map={};
  for(let i=1;i<arr.length;i++){
    const previous=arr[i-1],current=arr[i];
    if(dateAfter(previous.date)!==current.date)continue;
    let amount=null,method='';
    // If both snapshots include per-asset prices, compare yesterday's holdings
    // at both observed prices. Cash invested is never counted as profit.
    if(previous.prices&&current.prices&&previous.positions){
      let delta=0,valid=true;
      for(const [id,pos] of Object.entries(previous.positions)){
        const p0=Number(previous.prices[id]),p1=Number(current.prices[id]);
        const q=Number(pos.q);
        const r0=pos.currency==='USD'?Number(previous.fx):1;
        const r1=pos.currency==='USD'?Number(current.fx):1;
        if(!(p0>0&&p1>0&&r0>0&&r1>0&&q>=0)){
          valid=false;break;
        }
        delta+=q*(p1*r1-p0*r0);
      }
      // Do not claim a complete daily portfolio P&L when assets were sold,
      // since sale proceeds and realized profit cannot be inferred here.
      const sold=Object.entries(previous.positions).some(([id,pos])=>
        Number(current.positions?.[id]?.q??0)<Number(pos.q)-1e-7);
      if(valid&&!sold){amount=delta;method='期初持倉按兩次行情估值的價格變動（已排除新買入本金）';}
    }
    // Older snapshots do not contain individual prices.
    if(amount===null&&samePositions(previous.positions,current.positions)){
      amount=Number(current.unrealized)-Number(previous.unrealized);
      method='持倉不變時的未實現損益差額';
    }
    if(!Number.isFinite(amount))continue;
    map[current.date]={amount,pct:previous.value>0?amount/previous.value*100:null,
      previous,current,method};
  }
  return map;
}
let calendarDate=new Date(),calendarMode='daily',calendarSelected=null;
function setCalendarMonth(offset){
  calendarDate=new Date(calendarDate.getFullYear(),calendarDate.getMonth()+offset,1);
  calendarSelected=null;renderCalendar();
}
function calendarSigned(n){return (n>0?'+':'')+money(n);}
function calendarTone(n){return n>0?'negative':n<0?'positive':'';}
function renderCalendar(){
  const grid=byId('calendarGrid');if(!grid)return;
  const year=calendarDate.getFullYear(),month=calendarDate.getMonth();
  const prefix=`${year}-${String(month+1).padStart(2,'0')}`;
  const changes=dailyChanges();
  byId('calendarMonth').textContent=`${year} 年 ${month+1} 月`;
  const first=new Date(year,month,1),last=new Date(year,month+1,0).getDate();
  const offset=(first.getDay()+6)%7;
  const rows=[];
  for(let start=0;start<Math.ceil((offset+last)/7)*7;start+=7){
    const days=[];
    for(let j=0;j<7;j++){
      const n=start+j-offset+1;days.push(n>=1&&n<=last?n:null);
    }
    rows.push(days);
  }
  const monthEntries=Object.entries(changes).filter(([d])=>d.startsWith(prefix));
  const monthAmount=monthEntries.reduce((sum,[,x])=>sum+x.amount,0);
  const pnl=byId('calendarMonthPnl');
  pnl.textContent=monthEntries.length?calendarSigned(monthAmount):'—';
  pnl.className=monthEntries.length?calendarTone(monthAmount):'';
  byId('calendarMonthReturn').textContent='—';
  // The CSS originally used six columns; override for the seven-day layout.
  grid.style.gridTemplateColumns='repeat(7,minmax(0,1fr))';
  let html=['一','二','三','四','五','六','日']
    .map(s=>`<div class="calendar-head">${s}</div>`).join('');
  let cumulative=0;
  for(const days of rows){
    let weekAmount=0,weekCount=0;
    for(const n of days){
      if(!n){html+='<div class="calendar-cell empty"></div>';continue;}
      const d=`${prefix}-${String(n).padStart(2,'0')}`,x=changes[d];
      if(x){weekAmount+=x.amount;weekCount++;cumulative+=x.amount;}
      const shown=x?(calendarMode==='daily'?x.amount:cumulative):null;
      const amountText=shown===null?'—':(shown>0?'+':'')+
        Math.round(shown).toLocaleString('zh-TW');
      const percentText=x&&calendarMode==='daily'&&x.pct!==null?
        (x.pct>0?'+':'')+x.pct.toFixed(2)+'%':'';
      html+=`<button type="button" class="calendar-cell ${d===twDate()?'today':''} ${d===calendarSelected?'selected':''}"
        data-calendar-day="${d}" style="color:inherit;cursor:pointer">
        <span class="calendar-day">${n}</span>
        <span class="calendar-amount ${shown===null?'':calendarTone(shown)}">${amountText}</span>
        <span class="calendar-percent">${percentText}</span></button>`;
    }
    html+=`<div class="calendar-cell week-total" style="grid-column:1/-1;min-height:36px;display:flex;align-items:center;justify-content:space-between;padding:7px 12px">
      <span class="calendar-day">週損益（${weekCount} 天有資料）</span>
      <span class="calendar-amount ${weekCount?calendarTone(weekAmount):''}">
      ${weekCount?calendarSigned(weekAmount):'—'}</span></div>`;
  }
  grid.innerHTML=html;
  grid.querySelectorAll('[data-calendar-day]').forEach(button=>{
    button.addEventListener('click',()=>{
      calendarSelected=button.dataset.calendarDay;renderCalendar();
    });
  });
  const detail=byId('calendarDetail');
  if(detail){
    const x=calendarSelected?changes[calendarSelected]:null;
    detail.innerHTML=`<h3>${calendarSelected?safe(calendarSelected)+' · ':'每日'}損益明細</h3>`+
      (x?`<p class="${calendarTone(x.amount)}">${calendarSigned(x.amount)}
        ${x.pct===null?'':`（${x.pct.toFixed(2)}%）`}</p>
        <p class="hint">${safe(x.method)}<br>前次觀測：${money(x.previous.value)}<br>
        當次觀測：${money(x.current.value)}<br>這是觀測行情的估算，非券商官方日結。</p>`:
        '<p class="hint">此日期沒有可比較的連續兩日完整估值；缺少的歷史行情不會自動補造。</p>');
  }
  byId('calendarNote').textContent='日曆依開啟網站時記錄的完整行情快照估算；'+
    '有前後兩天的逐檔報價時，以前一天持倉計算價格變動，排除新買入本金。'+
    '賣出、缺少報價或沒有連續快照時不強行推算。'+
    '週／月僅加總有資料的日期，不代表完整期間績效；報酬率因此暫不顯示。';
}

function installCalendar(){byId('calendarPrev')?.addEventListener('click',()=>setCalendarMonth(-1));byId('calendarNext')?.addEventListener('click',()=>setCalendarMonth(1));byId('calendarDailyMode')?.addEventListener('click',()=>{calendarMode='daily';byId('calendarDailyMode').classList.add('active');byId('calendarCumulativeMode').classList.remove('active');renderCalendar();});byId('calendarCumulativeMode')?.addEventListener('click',()=>{calendarMode='cumulative';byId('calendarCumulativeMode').classList.add('active');byId('calendarDailyMode').classList.remove('active');renderCalendar();});}
function openingAssets(){return state.assets.filter(a=>Number(a.qty)>0);}
function saveOpeningDate(id){
  const a=state.assets.find(x=>x.id===id);
  if(!a)return;
  const input=byId('opening-date-'+id);
  const d=input?.value||'';
  if(d&&(!dateValid(d)||d>twDate()))return alert('請輸入有效且不晚於今天的日期');
  a.openingDate=d;
  save();renderHistory();
  alert(d?'首次投入日期已儲存':'已清除首次投入日期');
}
function renderHistory(){
  const y=byId('recordYearFilter'),m=byId('recordMonthFilter'),type=byId('recordTypeFilter');
  if(!y||!m||!type)return;
  const opening=openingAssets();
  const years=[...new Set([
    ...state.trades.map(t=>String(t.date||'').slice(0,4)),
    ...opening.map(a=>String(a.openingDate||'').slice(0,4))
  ].filter(v=>/^\d{4}$/.test(v)))].sort().reverse();
  const selectedYear=y.value;
  y.innerHTML='<option value="all">全部年份</option>'+years.map(v=>
    `<option value="${v}">${v} 年</option>`).join('');
  y.value=years.includes(selectedYear)?selectedYear:'all';
  const matchesDate=d=>(y.value==='all'||String(d).startsWith(y.value+'-'))&&
    (m.value==='all'||String(d).slice(5,7)===m.value);
  const entries=[];
  if(type.value!=='opening'){
    for(const t of state.trades){
      if(!matchesDate(t.date))continue;
      if(type.value==='estimated'&&!t.estimated)continue;
      if(['buy','sell'].includes(type.value)&&t.side!==type.value)continue;
      const a=state.assets.find(x=>x.id===t.asset);
      entries.push({date:t.date||'',order:t.created||0,html:`<div class="item">
        <div class="between"><b>${safe(t.asset)} · ${t.side==='buy'?'買入':'賣出'}
        ${t.estimated?' · 🟡 預估入庫':''}</b>
        <button class="secondary" onclick="deleteTrade(${Number(t.created)})">刪除</button></div>
        <small>${safe(t.date||'日期待補')} · ${fmtQty(t.qty)} ×
        ${money(Number(t.price),a?.currency||'TWD')} · 費用
        ${money(Number(t.fee)||0,a?.currency||'TWD')}</small>
        ${t.estimated?`<p class="hint">總扣款 ${money(Number(t.twdTotal))} · 預估匯率
          ${Number(t.fxAtEntry).toFixed(4)} · 股數待券商確認</p>
          <button class="secondary" onclick="confirmEstimatedTrade(${Number(t.created)})">修正／確認入庫</button>`:''}
        </div>`});
    }
  }
  if(type.value==='all'||type.value==='opening'){
    for(const a of opening){
      const d=a.openingDate||'';
      if(!d&&(y.value!=='all'||m.value!=='all'))continue;
      if(d&&!matchesDate(d))continue;
      entries.push({date:d,order:0,html:`<div class="item">
        <div class="between"><b>${safe(a.name)} · 期初持倉</b>
        <small>${d?safe(d):'日期待補'}</small></div>
        <small>${fmtQty(a.qty)} 單位 · 期初成本 ${money(Number(a.cost),a.currency)}</small>
        <p class="hint">首次投入日期僅供時間排序，不代表全部單位於當天一次買入。</p></div>`});
    }
  }
  entries.sort((a,b)=>b.date.localeCompare(a.date)||b.order-a.order);
  byId('recordlist').innerHTML=entries.length?entries.map(x=>x.html).join(''):
    '<p class="history-empty">此篩選條件下沒有已記錄資料</p>';
  const openingEl=byId('openingHistoryList');
  if(openingEl)openingEl.innerHTML=opening.slice().sort((a,b)=>
    String(a.openingDate||'9999').localeCompare(String(b.openingDate||'9999')))
    .map(a=>`<div class="history-entry"><div class="between"><b>${safe(a.name)}</b>
      <span class="${a.openingDate?'':'history-unknown'}">${a.openingDate?safe(a.openingDate):'日期待補'}</span></div>
      <small>${fmtQty(a.qty)} 單位 · 期初成本 ${money(Number(a.cost),a.currency)}</small>
      <label>首次投入日期（不知道可留空）
      <input type="date" id="opening-date-${safe(a.id)}" value="${safe(a.openingDate||'')}" max="${twDate()}"></label>
      <button class="secondary" type="button" onclick="saveOpeningDate('${safe(a.id)}')">儲存日期</button>
      </div>`).join('')||'<p class="hint">目前沒有期初持倉</p>';
  const totalCost=state.assets.reduce((sum,a)=>{
    const z=valuation(a);return sum+(z.costTwd??0);
  },0);
  byId('historyTotalCost').textContent=money(totalCost);
  byId('historyTradeCount').textContent=state.trades.length+' 筆';
  byId('historyUnknownCount').textContent=opening.filter(a=>!a.openingDate).length+' 檔';
  const thisMonth=twDate().slice(0,7);
  let known=0,uncertain=0;
  for(const t of state.trades){
    if(!String(t.date).startsWith(thisMonth)||t.side!=='buy')continue;
    const a=state.assets.find(x=>x.id===t.asset);if(!a)continue;
    if(a.currency==='TWD')known+=Number(t.qty)*Number(t.price)+(Number(t.fee)||0);
    else if(Number.isFinite(Number(t.twdTotal))&&Number(t.twdTotal)>0)known+=Number(t.twdTotal);
    else uncertain++;
  }
  byId('historyMonthInput').textContent=money(known)+(uncertain?'（另有待核對）':'');
}

// External history is DOCUMENTARY ONLY: never add it to assets, trades, or snapshots.
let historicalArchive=null;
let historicalArchiveError='讀取中…';
const historicalStatusLabels={reported_confirmed:'先前對話已確認',confirmed_in_backup:'備份有紀錄',reported_unverified:'待核對原始紀錄',needs_review:'待核對',estimated:'預估交易',historical_snapshot:'歷史快照'};
const historicalSourceLabels={backup_20261113:'2026/11/13 JSON 備份',conversation_history:'先前對話紀錄',previous_compilation:'先前對話彙整（未重驗原圖）'};
function historicalNumber(v){return v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;}
function historicalMoney(v){const n=historicalNumber(v);return n===null?'—':money(n);}
function ensureHistoricalArchivePanel(){
  let panel=byId('historicalArchivePanel');if(panel)return panel;
  const section=byId('records');if(!section)return null;
  panel=document.createElement('div');panel.id='historicalArchivePanel';panel.className='card';
  const heading=document.createElement('h2');heading.textContent='2026/03 起 · 歷史投資檔案';panel.appendChild(heading);
  const explanation=document.createElement('p');explanation.className='hint';explanation.textContent='以下是 history.json 的唯讀歷史參考，不會更動持倉、成本、交易紀錄或每日損益。歷史投入不會再加到目前本金。';panel.appendChild(explanation);
  const controls=document.createElement('div');controls.className='record-filters';
  const yearLabel=document.createElement('label');yearLabel.textContent='歷史年份';
  const year=document.createElement('select');year.id='historicalArchiveYear';yearLabel.appendChild(year);
  const statusLabel=document.createElement('label');statusLabel.textContent='核對狀態';
  const status=document.createElement('select');status.id='historicalArchiveStatus';
  status.innerHTML='<option value="all">全部狀態</option><option value="confirmed">已確認／有備份</option><option value="pending">待核對</option><option value="estimated">預估</option><option value="snapshot">歷史快照</option>';
  statusLabel.appendChild(status);controls.append(yearLabel,statusLabel);panel.appendChild(controls);
  const monthLabel=document.createElement('label');monthLabel.textContent='歷史月份';
  const month=document.createElement('select');month.id='historicalArchiveMonth';month.innerHTML='<option value="all">全部月份</option>'+Array.from({length:12},(_,i)=>`<option value="${String(i+1).padStart(2,'0')}">${i+1} 月</option>`).join('');
  monthLabel.appendChild(month);panel.appendChild(monthLabel);
  const info=document.createElement('div');info.id='historicalArchiveInfo';panel.appendChild(info);
  const list=document.createElement('div');list.id='historicalArchiveList';panel.appendChild(list);
  const monthly=document.createElement('details');monthly.id='historicalArchiveMonthly';monthly.innerHTML='<summary>查看 3～11 月每月整理摘要</summary><div id="historicalArchiveMonthlyContent"></div>';panel.appendChild(monthly);
  section.insertBefore(panel,section.children[1]||null);
  [year,month,status].forEach(el=>el.addEventListener('change',renderHistoricalArchive));
  return panel;
}
function archiveCategory(status,kind){
  if(kind==='snapshot')return 'snapshot';
  if(status==='reported_confirmed'||status==='confirmed_in_backup')return 'confirmed';
  if(status==='estimated')return 'estimated';
  return 'pending';
}
function archiveSource(id){return historicalSourceLabels[id]||id||'來源未標示';}
function renderHistoricalArchive(){
  if(!ensureHistoricalArchivePanel())return;
  const info=byId('historicalArchiveInfo'),list=byId('historicalArchiveList'),monthly=byId('historicalArchiveMonthlyContent');
  if(!historicalArchive){info.innerHTML=`<p class="hint">${safe(historicalArchiveError)}</p>`;list.innerHTML='';if(monthly)monthly.innerHTML='';return;}
  const archive=historicalArchive;
  const events=archive.historical_events||[],snaps=archive.asset_snapshots||[],months=archive.monthly_overview||[];
  const year=byId('historicalArchiveYear'),month=byId('historicalArchiveMonth'),status=byId('historicalArchiveStatus');
  const availableYears=[...new Set([...events,...snaps].map(x=>String(x.date||'').slice(0,4)).filter(x=>/^\d{4}$/.test(x)))].sort().reverse();
  const oldYear=year.value;year.innerHTML='<option value="all">全部年份</option>'+availableYears.map(x=>`<option value="${x}">${x} 年</option>`).join('');year.value=availableYears.includes(oldYear)?oldYear:'all';
  const rows=[...events.map(x=>({...x,archiveKind:'event'})),...snaps.map(x=>({...x,archiveKind:'snapshot'}))].filter(x=>
    (year.value==='all'||x.date.startsWith(year.value+'-'))&&
    (month.value==='all'||x.date.slice(5,7)===month.value)&&
    (status.value==='all'||archiveCategory(x.status,x.archiveKind)===status.value)
  ).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
  const confirmed=events.filter(x=>archiveCategory(x.status,'event')==='confirmed').length;
  const pending=events.filter(x=>archiveCategory(x.status,'event')==='pending').length;
  info.innerHTML=`<p class="hint">資料範圍：${safe(archive.coverage?.start||'未知')} ～ ${safe(archive.coverage?.end||'未知')} · ${events.length} 筆歷史事件（${confirmed} 筆先前確認或備份有紀錄、${pending} 筆待核對） · ${snaps.length} 筆資產快照。所有紀錄均不重複計入本金。</p>`;
  list.innerHTML=rows.length?rows.map(x=>{
    const isSnap=x.archiveKind==='snapshot';
    const name=isSnap?({'five_funds_only':'五檔基金','four_funds_only':'四檔基金','funds_only':'基金部位','website_reported_total':'網站總資產'}[x.scope]||x.scope):x.asset_name||x.asset_id||'未標示標的';
    const parts=isSnap?[
      '歷史市值 '+(x.approximate?'約 ':'')+historicalMoney(x.market_value_twd),
      historicalNumber(x.cost_twd)!==null?'當時成本 '+historicalMoney(x.cost_twd):null,
      historicalNumber(x.cumulative_pnl_twd)!==null?'當時累計損益 '+historicalMoney(x.cumulative_pnl_twd):null,
      '單日損益未核實'
    ]:[
      historicalNumber(x.amount_twd)!==null?'先前回報投入 '+historicalMoney(x.amount_twd):null,
      historicalNumber(x.twd_total)!==null?'當時預估扣款 '+historicalMoney(x.twd_total):null,
      historicalNumber(x.quantity)!==null?'數量 '+fmtQty(x.quantity):null,
      historicalNumber(x.price_twd)!==null?'參考單價 '+historicalMoney(x.price_twd):null,
      historicalNumber(x.price_usd)!==null?'參考單價 '+money(Number(x.price_usd),'USD'):null
    ];
    const tag=historicalStatusLabels[x.status]||x.status||'待核對';
    return `<div class="history-entry"><div class="between"><b>${safe(x.date)} · ${safe(name)}</b><small class="${archiveCategory(x.status,x.archiveKind)==='pending'?'history-unknown':'muted'}">${safe(tag)}</small></div><p class="hint">${parts.filter(Boolean).map(safe).join(' · ')}</p><small>來源：${safe(archiveSource(x.source_id))}</small>${x.notes?`<p class="hint">${safe(x.notes)}</p>`:''}</div>`;
  }).join(''):'<p class="history-empty">此篩選條件下沒有歷史紀錄</p>';
  if(monthly)monthly.innerHTML=months.map(x=>`<div class="history-entry"><b>${safe(x.month)}</b><p class="hint">先前回報投入：${x.approximate?'約 ':''}${historicalMoney(x.reported_investment_twd)} · ${safe(historicalStatusLabels[x.amount_status]||'待核對')}</p><small>${safe(x.detail||'')}${x.through_date?'（截至 '+safe(x.through_date)+'）':''}</small></div>`).join('');
}
async function loadHistoricalArchive(){
  ensureHistoricalArchivePanel();
  try{
    const response=await fetch('./history.json?v=26111303',{cache:'no-store'});
    if(!response.ok)throw Error('找不到 history.json（HTTP '+response.status+'）');
    const data=await response.json();
    if(data.schema!=='marlowe-wealth-history-v1'||!Array.isArray(data.historical_events)||!Array.isArray(data.asset_snapshots)||!Array.isArray(data.monthly_overview))throw Error('history.json 格式不符合預期');
    historicalArchive=data;historicalArchiveError='';
  }catch(error){historicalArchive=null;historicalArchiveError='歷史檔案讀取失敗：'+error.message+'。請確認 history.json 已放在與 app.js 相同的 GitHub 根目錄。';}
  renderHistoricalArchive();
}
function installHistoryFilters(){for(const id of ['recordYearFilter','recordMonthFilter','recordTypeFilter'])byId(id)?.addEventListener('change',renderHistory);}

function render(){const totals={tw:0,us:0,fund:0,crypto:0},counts={tw:0,us:0,fund:0,crypto:0};let v=0,c=0,covered=0,all=0;for(const a of state.assets){const z=valuation(a);if(z.q<=0)continue;all++;if(z.value!==null){totals[a.type]=(totals[a.type]||0)+z.value;counts[a.type]=(counts[a.type]||0)+1;v+=z.value;covered++;if(z.costTwd!==null)c+=z.costTwd;}}byId('total').textContent=covered?money(v):'尚無可估值資產';byId('pnl').textContent=covered&&c>0?'可估值部位未實現損益 '+money(v-c)+'（'+((v/c-1)*100).toFixed(2)+'%）':'損益待確認';byId('pnl').className=covered&&v-c<0?'negative':'positive';const estCount=state.trades.filter(t=>t.estimated).length;byId('coverage').textContent=`已估值 ${covered}/${all} 檔；未估值部位不計入總額。美元成本以目前匯率換算，非實際匯兌損益。期初成本待核對。`+(estCount?` 有 ${estCount} 筆預估入庫，股數及損益可能變動。`:'');for(const [type,id] of [['tw','twtotal'],['us','ustotal'],['fund','fundtotal'],['crypto','cryptototal']])byId(id).textContent=counts[type]?money(totals[type]):'待估值';byId('count').textContent=covered+' / '+all;byId('progresslabel').textContent=covered?`${(v/300000*100).toFixed(1)}%（部分估值${estCount?'・含預估':''}）`:'—';byId('progress').style.width=Math.max(0,Math.min(100,v/300000*100))+'%';renderCategoryDetails(totals);renderAllocation(totals);renderBtcStatus();byId('marketinfo').innerHTML=state.assets.map(a=>{const z=valuation(a),s=a.id==='BTC'?btcQuoteStatus():null,time=a.id==='BTC'&&z.p?.automatic?taiwanTime(z.p.retrieved_at):z.p?.date||'日期未知';return `<div class="item"><div class="between"><b>${safe(a.name)}</b><small>${safe(time)}</small></div><small>${z.p?money(num(z.p.value),a.currency)+' / 單位 · '+safe(z.p.source||'手動'):'無法估值'}${a.currency==='USD'&&!fx()?' · 缺 USD/TWD':''}</small>${s?`<p class="hint"><span class="${s.stale?'negative':'positive'}">${safe(s.label)}</span> · ${safe(s.detail)}</p>`:''}</div>`;}).join('');byId('holdlist').innerHTML=state.assets.map(a=>{const z=valuation(a),n=estimatedTrades(a.id).length,s=a.id==='BTC'?btcQuoteStatus():null;return `<div class="item"><div class="between"><b>${safe(a.name)}</b><small>${a.type==='fund'?'基金':a.type==='us'?'美股':a.type==='crypto'?'加密貨幣':'台股'}${n?' · 🟡 含預估 '+n+' 筆':''}</small></div><p class="muted">${safe(a.id)} · ${a.type==='crypto'?z.q.toFixed(8):z.q.toFixed(5)} 單位 · 成本 ${money(z.c,a.currency)}</p><div class="between"><b>${money(z.value)}</b><small>${z.value!==null&&z.costTwd!==null?money(z.value-z.costTwd):'損益待確認'}</small></div><small>${z.p?'報價 '+safe(z.p.automatic?taiwanTime(z.p.retrieved_at):z.p.date||'未知'):'尚未取得價格'} · ${a.verified?'已核對':'期初成本待核對'}${n?' · 預估持倉非券商正式股數':''}</small>${s?`<p class="hint ${s.stale?'negative':'positive'}">${safe(s.label)}</p>`:''}<details><summary>校正期初持倉</summary><label>期初數量<input type="number" step="any" id="q-${safe(a.id)}" value="${a.qty}"></label><label>期初總成本（${a.currency}）<input type="number" step="any" id="c-${safe(a.id)}" value="${a.cost}"></label><button onclick="updateBase('${safe(a.id)}')">儲存校正</button><p class="hint">此處只改期初基準，不會清除後續交易。</p></details></div>`;}).join('');for(const id of ['tradeasset','manualasset']){const el=byId(id),selected=el.value;el.innerHTML=state.assets.map(a=>`<option value="${safe(a.id)}">${safe(a.name)}</option>`).join('');if(state.assets.some(a=>a.id===selected))el.value=selected;}byId('feeddate').textContent=feed.updated_at?'行情檔更新：'+taiwanTime(feed.updated_at):'尚未取得自動行情';byId('feedstatus').textContent=feedError?'行情讀取失敗':feed.updated_at?'行情已讀取':'行情未就緒';updateEstimatePreview();renderPendingSummary();renderHistory();renderHistoricalArchive();renderCalendar();}
function updateBase(id){const a=state.assets.find(x=>x.id===id),q=num(byId('q-'+id)?.value),c=num(byId('c-'+id)?.value);if(!a||!Number.isFinite(q)||q<0||!Number.isFinite(c)||c<0)return alert('請填入有效數值');a.qty=q;a.cost=c;a.verified=true;save();render();}
function showAddAsset(){byId('assetform').classList.toggle('hidden');}
function addAsset(){const id=byId('asymbol').value.trim().toUpperCase();if(!id||state.assets.some(a=>a.id===id))return alert('代碼空白或已存在');state.assets.push({id,name:byId('aname').value.trim()||id,type:byId('atype').value,currency:byId('acurrency').value,qty:0,cost:0,verified:true});save();render();showAddAsset();}
function uniqueTradeId(){let id=Date.now();while(state.trades.some(t=>t.created===id))id++;return id;}
function addTrade(){const asset=byId('tradeasset').value,side=byId('tradeside').value,date=byId('tradedate').value,qty=num(byId('tradeqty').value),p=num(byId('tradeprice').value),fee=num(byId('tradefee').value||0);if(!dateValid(date)||!(qty>0)||!(p>0)||!Number.isFinite(fee)||fee<0)return alert('請填入完整有效的交易資料');const a=state.assets.find(x=>x.id===asset);if(!a)return alert('找不到投資標的');if(side==='sell'&&qty>position(a).q+1e-8)return alert('賣出數量超過持倉');const duplicate=state.trades.some(t=>t.asset===asset&&t.side===side&&t.date===date&&closeEnough(Number(t.qty),qty)&&closeEnough(Number(t.price),p));if(duplicate&&!confirm('已有相同標的、日期、數量與價格的紀錄，仍要新增嗎？'))return;state.trades.push({asset,side,date,qty,price:p,fee,created:uniqueTradeId()});save();render();alert('交易已儲存');}
function deleteTrade(created){if(!confirm('確定刪除這筆交易？'))return;state.trades=state.trades.filter(t=>t.created!==created);save();render();}
function saveManual(){const id=byId('manualasset').value,value=num(byId('manualprice').value),date=byId('manualdate').value;if(!(value>0)||!dateValid(date))return alert('請填價格與日期');state.manual[id]={value,date,source:'手動輸入'};save();render();if(id==='BTC'&&validBtcFeedQuote(feed.prices?.BTC))alert('手動價格已儲存為備援。BTC 目前仍優先使用 BitoPro 自動行情。');}
function clearManual(){delete state.manual[byId('manualasset').value];save();render();}
function saveFx(){const raw=byId('fx').value,next=raw===''?null:num(raw);if(next!==null&&!(next>0))return alert('匯率必須大於 0');state.fxOverride=next;save();render();}
function exportData(){const blob=new Blob([JSON.stringify({exported_at:new Date().toISOString(),...state},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='wealth-v2-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function importData(e){const file=e.target.files?.[0];if(!file)return;try{const x=JSON.parse(await file.text());if(x.version!==2||!Array.isArray(x.assets)||!Array.isArray(x.trades))throw Error('非 V2 備份');if(!confirm('確定覆蓋目前 V2 資料？請先備份。'))return;state=x;if(!state.manual||typeof state.manual!=='object')state.manual={};if(!state.history||typeof state.history!=='object')state.history={};if(!Array.isArray(state.history.snapshots))state.history.snapshots=[];save();render();}catch(err){alert('匯入失敗：'+err.message);}finally{e.target.value='';}}
function resetDemo(){if(!confirm('這會清除目前 V2 的持倉與交易，確定嗎？'))return;state={version:2,assets:[],trades:[],manual:{},fxOverride:null,history:{snapshots:[]}};save();render();}
async function loadFeed(bust=false){try{const r=await fetch('market.json'+(bust?'?t='+Date.now():''),{cache:'no-store'});if(!r.ok)throw Error('行情檔尚未建立');const j=await r.json();if(!j||!j.prices||typeof j.prices!=='object'||Array.isArray(j.prices))throw Error('行情格式不正確');feed=j;feedError=null;recordSnapshot();render();window.dispatchEvent(new Event('wealth:feed-loaded'));}catch(e){feedError=e.message;render();byId('feedstatus').textContent='行情讀取失敗';byId('feeddate').textContent=e.message;}}
function installEstimatedUI(){const select=byId('tradeasset');if(!select||byId('estimatePanel'))return;const section=select.closest('section')||select.parentElement.parentElement,panel=document.createElement('div');panel.id='estimatePanel';panel.className='item';panel.innerHTML=`<h3>🟡 預估入庫（台幣定期定額）</h3><p class="hint">已下單／扣款但尚未取得正式股數時使用。儲存後立即計入持倉與估值；股數為預估值。</p><label>總投入金額（TWD，含手續費）<input id="estimateTwd" type="number" min="0" step="0.01" value="24600" inputmode="decimal"></label><label>手續費率（%）<input id="estimateFeeRate" type="number" min="0" step="0.001" value="0.1" inputmode="decimal"></label><label>參考 USD/TWD 匯率<input id="estimateFx" type="number" min="0" step="any" placeholder="自動行情匯率，可自行修改" inputmode="decimal"></label><label>參考成交價（USD／股）<input id="estimatePrice" type="number" min="0" step="any" placeholder="自動帶入 VOO 行情，可自行修改" inputmode="decimal"></label><p id="estimatePreview" class="hint">等待參考價格與匯率…</p><button id="estimateSave" type="button">立即預估入庫</button><p class="hint">請勿再用上方「儲存交易」重複新增同一筆。</p>`;section.appendChild(panel);byId('estimateSave').addEventListener('click',addEstimatedTrade);for(const id of ['estimateTwd','estimateFeeRate','estimateFx','estimatePrice'])byId(id).addEventListener('input',updateEstimatePreview);select.addEventListener('change',updateEstimatePreview);byId('tradeside').addEventListener('change',updateEstimatePreview);}
function estimateInputs(){const a=state.assets.find(x=>x.id===byId('tradeasset')?.value),total=num(byId('estimateTwd')?.value),feeRate=num(byId('estimateFeeRate')?.value),rate=num(byId('estimateFx')?.value)||fx(),p=num(byId('estimatePrice')?.value)||num(a&&price(a)?.value),feeTwd=Math.round(total*feeRate/100*100)/100,principal=total-feeTwd;return {a,total,feeRate,rate,p,feeTwd,principal,qty:principal/rate/p,feeUsd:feeTwd/rate};}
function updateEstimatePreview(){const panel=byId('estimatePanel');if(!panel)return;const a=state.assets.find(x=>x.id===byId('tradeasset').value),enabled=!!a&&a.currency==='USD'&&byId('tradeside').value==='buy';panel.style.display=enabled?'':'none';if(!enabled)return;const rateEl=byId('estimateFx'),pEl=byId('estimatePrice');if(!rateEl.dataset.userEdited&&fx())rateEl.value=fx();const current=num(price(a)?.value);if(!pEl.dataset.userEdited&&current>0)pEl.value=current;const x=estimateInputs();byId('estimatePreview').textContent=x.total>0&&x.feeRate>=0&&x.principal>0&&x.rate>0&&x.p>0?`手續費 ${money(x.feeTwd)}｜買入本金 ${money(x.principal)}｜預估 ${fmtQty(x.qty)} 股｜匯率 ${x.rate}｜參考股價 ${money(x.p,'USD')}`:'請填入有效金額、參考匯率與美元股價後即可估算。';}
function addEstimatedTrade(){const x=estimateInputs(),date=byId('tradedate').value;if(!x.a||x.a.currency!=='USD'||!dateValid(date)||!(x.total>0)||!(x.feeRate>=0)||!(x.principal>0)||!(x.rate>0)||!(x.p>0)||!Number.isFinite(x.qty))return alert('請確認日期、台幣金額、費率、匯率與美元股價');if(!confirm(`將 ${money(x.total)} 記為「預估入庫」？\n預估 ${fmtQty(x.qty)} 股 ${x.a.id}。\n正式成交後可修正原交易。`))return;const duplicate=state.trades.some(t=>t.asset===x.a.id&&t.side==='buy'&&t.date===date&&t.estimated&&closeEnough(Number(t.twdTotal),x.total));if(duplicate)return alert('已有相同日期與金額的預估入庫，未新增重複交易。');state.trades.push({asset:x.a.id,side:'buy',date,qty:x.qty,price:x.p,fee:x.feeUsd,created:uniqueTradeId(),estimated:true,twdTotal:x.total,twdFee:x.feeTwd,fxAtEntry:x.rate});save();render();alert('已預估入庫；請勿重複新增同一筆交易');}
function confirmEstimatedTrade(created){const t=state.trades.find(t=>t.created===created&&t.estimated);if(!t)return alert('找不到預估交易');const qRaw=prompt('輸入券商實際成交股數（股）：',String(t.qty));if(qRaw===null)return;const pRaw=prompt('輸入實際美元成交均價（USD／股）：',String(t.price));if(pRaw===null)return;const fRaw=prompt('輸入實際交易手續費（USD）：',String(t.fee));if(fRaw===null)return;const q=Number(qRaw),p=Number(pRaw),f=Number(fRaw);if(!qRaw.trim()||!pRaw.trim()||!fRaw.trim()||!(q>0)||!(p>0)||!Number.isFinite(f)||f<0)return alert('成交股數、價格、手續費必須為有效數值');if(!confirm('確認實際股數、成交價與手續費已核對？將直接修正原交易，不另新增。'))return;t.qty=q;t.price=p;t.fee=f;t.estimated=false;t.confirmedAt=new Date().toISOString();save();render();alert('已確認入庫，原交易已更新');}
function renderPendingSummary(){let el=byId('estimatedSummary');if(!el){const target=byId('total')?.closest('.card')||byId('total')?.parentElement;if(!target)return;el=document.createElement('div');el.id='estimatedSummary';el.className='item';target.appendChild(el);}const pending=state.trades.filter(t=>t.estimated);if(!pending.length){el.style.display='none';return;}el.style.display='';const total=pending.reduce((s,t)=>s+(num(t.twdTotal)||0),0);el.innerHTML=`<b>🟡 預估入庫 · ${pending.length} 筆</b><p>已記入持倉的預估投入：${money(total)}</p><small>此金額已反映於預估持倉，請勿與總資產再相加。實際成交股數、匯率及損益仍待券商確認。</small>`;}
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('main>section').forEach(s=>s.classList.toggle('hidden',s.id!==b.dataset.tab));document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));window.scrollTo(0,0);}));
byId('tradedate').value=today();byId('manualdate').value=today();
try{installEstimatedUI();for(const id of ['estimateFx','estimatePrice'])byId(id)?.addEventListener('input',e=>{e.target.dataset.userEdited='1';});installAssetCardInteractions();installCalendar();installHistoryFilters();render();loadHistoricalArchive();loadFeed();}catch(e){byId('feedstatus').textContent='程式錯誤：'+e.message;alert('WEALTH 啟動失敗：'+e.message);}
