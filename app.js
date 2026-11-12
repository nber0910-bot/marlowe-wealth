
'use strict';

// MARLOWE WEALTH V26.1113
// BTC automatic market integration
// Data storage remains marlowe_wealth_v2.

const KEY = 'marlowe_wealth_v2';
const BTC_STALE_HOURS = 2;

const initial = [
  ['009816','009816','tw','TWD',1205,19015],
  ['00646','元大 S&P500','tw','TWD',281,22016],
  ['VOO','VOO','us','USD',0.06109,43.04],
  ['FUBON_SP500','富邦標普500','fund','TWD',3307.47,36700],
  ['FUBON_NASDAQ100','富邦 NASDAQ-100','fund','TWD',2705.29,31000],
  ['YUANTA_NEW','元大新主流','fund','TWD',133.5,24800],
  ['YUANTA_DIV','元大台灣高股息優質龍頭','fund','TWD',212.8,7539],
  ['BTC','Bitcoin (BTC)','crypto','TWD',0,0]
];

const seed = () => ({
  version:2,
  assets:initial.map(([id,name,type,currency,qty,cost]) => ({
    id,name,type,currency,qty,cost,verified:false
  })),
  trades:[],
  manual:{},
  fxOverride:null
});

let state;

try {
  state = JSON.parse(localStorage.getItem(KEY)) || seed();
} catch {
  state = seed();
}

if (!Array.isArray(state.assets)) state.assets = [];
if (!Array.isArray(state.trades)) state.trades = [];
if (!state.manual || typeof state.manual !== 'object') {
  state.manual = {};
}

// Preserve existing BTC migration without duplicate trades.
if (!state.assets.some(a => a.id === 'BTC')) {
  state.assets.push({
    id:'BTC',
    name:'Bitcoin (BTC)',
    type:'crypto',
    currency:'TWD',
    qty:0,
    cost:0,
    verified:true
  });
}

const btcAsset = state.assets.find(a => a.id === 'BTC');

const btcAlreadyRecorded =
  (Number(btcAsset.qty) || 0) > 0 ||
  state.trades.some(t => t.asset === 'BTC');

if (!btcAlreadyRecorded) {
  state.trades.push({
    asset:'BTC',
    side:'buy',
    date:'2026-11-13',
    qty:0.0012974,
    price:2368360,
    fee:0,
    created:1794500000001,
    feeUnverified:true,
    note:'BitoPro BTC/TWD spot; fee pending verification'
  });
}

if (!state.manual.BTC) {
  state.manual.BTC = {
    value:2362249,
    date:'2026-11-13',
    source:'BitoPro 截圖參考價（非即時）'
  };
}

localStorage.setItem(KEY, JSON.stringify(state));

let feed = {
  prices:{},
  fx:null,
  updated_at:null
};

let feedError = null;

const save = () =>
  localStorage.setItem(KEY,JSON.stringify(state));

const money = (n,c='TWD') =>
  Number.isFinite(n)
    ? new Intl.NumberFormat('zh-TW',{
        style:'currency',
        currency:c,
        maximumFractionDigits:2
      }).format(n)
    : '待估值';

const num = n => Number(n);

const safe = s =>
  String(s ?? '').replace(/[&<>"']/g,c => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  }[c]));

const byId = id => document.getElementById(id);

const fmtQty = n =>
  Number(n).toFixed(8)
    .replace(/0+$/,'')
    .replace(/\.$/,'');

const today = () => {
  const d = new Date();
  const local = new Date(
    d.getTime() - d.getTimezoneOffset() * 60000
  );
  return local.toISOString().slice(0,10);
};

function fx() {
  const v = num(state.fxOverride ?? feed.fx?.value);
  return v > 0 ? v : null;
}

// -------------------------------------
// BTC automatic quote handling
// -------------------------------------

function validQuote(p) {
  return !!p &&
    typeof p === 'object' &&
    p.value !== null &&
    p.value !== undefined &&
    p.value !== '' &&
    Number.isFinite(Number(p.value)) &&
    Number(p.value) > 0;
}

function validBtcFeedQuote(p) {
  if (!validQuote(p)) return false;

  if (p.currency !== 'TWD') return false;
  if (p.pair !== 'btc_twd') return false;

  const timestamp = Date.parse(p.retrieved_at || '');

  if (!Number.isFinite(timestamp)) return false;

  // Reject timestamps unreasonably far in the future.
  if (timestamp > Date.now() + 5 * 60 * 1000) {
    return false;
  }

  return true;
}

function btcQuote() {
  const automatic = feed.prices?.BTC;

  if (validBtcFeedQuote(automatic)) {
    return {
      ...automatic,
      automatic:true
    };
  }

  const fallback = state.manual?.BTC;

  if (validQuote(fallback)) {
    return {
      ...fallback,
      automatic:false
    };
  }

  return null;
}

function price(a) {
  if (a.id === 'BTC') {
    return btcQuote();
  }

  return state.manual[a.id] ||
    feed.prices?.[a.id] ||
    null;
}

function btcQuoteStatus() {
  const p = btcQuote();

  if (!p) {
    return {
      label:'無可用報價',
      detail:'尚未取得 BTC/TWD 價格',
      stale:true,
      automatic:false
    };
  }

  if (!p.automatic) {
    return {
      label:'手動參考價',
      detail:'目前使用手動價格，並非即時行情',
      stale:true,
      automatic:false
    };
  }

  const timestamp = Date.parse(p.retrieved_at);
  const age = Date.now() - timestamp;
  const stale = age > BTC_STALE_HOURS * 3600000;

  return {
    label:stale ? '行情已過期' : '自動行情正常',
    detail:stale
      ? '超過 2 小時未取得新報價，仍顯示最後有效價格'
      : 'BitoPro 最近一次成功取得的行情快照',
    stale,
    automatic:true
  };
}

function taiwanTime(value) {
  const timestamp = Date.parse(value || '');

  if (!Number.isFinite(timestamp)) {
    return '時間未知';
  }

  return new Intl.DateTimeFormat('zh-TW',{
    timeZone:'Asia/Taipei',
    year:'numeric',
    month:'2-digit',
    day:'2-digit',
    hour:'2-digit',
    minute:'2-digit',
    hour12:false
  }).format(new Date(timestamp));
}

function renderBtcStatus() {
  const note = byId('btcPriceNote');
  if (!note) return;

  const p = btcQuote();
  const status = btcQuoteStatus();

  if (!p) {
    note.textContent =
      'BTC/TWD 尚無可用價格，等待 BitoPro 自動行情。';
    return;
  }

  if (p.automatic) {
    note.innerHTML = `
      <b class="${status.stale ? 'negative' : 'positive'}">
        BTC · ${safe(status.label)}
      </b>
      <br>
      BitoPro BTC/TWD：${money(Number(p.value))}
      <br>
      擷取時間：${safe(taiwanTime(p.retrieved_at))}
      <br>
      ${safe(status.detail)}
    `;
  } else {
    note.innerHTML = `
      <b class="negative">
        BTC · 手動參考價
      </b>
      <br>
      參考價格：${money(Number(p.value))}
      <br>
      參考日期：${safe(p.date || '未知')}
      <br>
      自動行情尚未取得，並非即時報價。
    `;
  }
}

// -------------------------------------
// Position and valuation
// -------------------------------------

function position(a) {
  let q = num(a.qty) || 0;
  let c = num(a.cost) || 0;

  const trades = state.trades
    .filter(t => t.asset === a.id)
    .sort((x,y) =>
      String(x.date).localeCompare(String(y.date)) ||
      (x.created || 0) - (y.created || 0)
    );

  for (const t of trades) {
    const tq = num(t.qty) || 0;
    const tp = num(t.price) || 0;
    const tf = num(t.fee) || 0;

    if (t.side === 'buy') {
      q += tq;
      c += tq * tp + tf;
    } else {
      if (tq > q + 1e-8) continue;

      const avg = q > 0 ? c/q : 0;
      c -= avg*tq;
      q -= tq;

      if (Math.abs(q) < 1e-8) {
        q = 0;
        c = 0;
      }
    }
  }

  return {q,c};
}

function valuation(a) {
  const {q,c} = position(a);
  const p = price(a);
  const rate = a.currency === 'USD' ? fx() : 1;

  const valid =
    q > 0 &&
    validQuote(p) &&
    rate > 0;

  return {
    q,c,p,
    value:valid ? q*num(p.value)*rate : null,
    costTwd:a.currency === 'USD' && rate
      ? c*rate
      : a.currency === 'TWD'
        ? c
        : null
  };
}

function estimatedTrades(id) {
  return state.trades.filter(
    t => t.asset === id && t.estimated === true
  );
}

// -------------------------------------
// Asset allocation
// -------------------------------------

const CATEGORY_ORDER = ['tw','us','fund','crypto'];

const CATEGORY_INFO = {
  tw:{name:'台股 ETF',color:'#83b8ff'},
  us:{name:'美股 ETF',color:'#83d9c1'},
  fund:{name:'基金',color:'#c5a4ff'},
  crypto:{name:'加密貨幣',color:'#f2bd74'}
};

function categoryRows(type) {
  return state.assets
    .filter(a => a.type === type)
    .map(a => ({
      asset:a,
      ...valuation(a)
    }))
    .filter(z => z.q > 0);
}

function renderCategoryDetails(totals) {
  for (const type of CATEGORY_ORDER) {
    const container = byId(type+'details');
    if (!container) continue;

    const rows = categoryRows(type);

    if (!rows.length) {
      container.innerHTML =
        '<p class="hint">目前沒有持倉</p>';
      continue;
    }

    container.innerHTML = rows.map(z => {
      const a = z.asset;
      const hasValue = z.value !== null;
      const hasPnL =
        hasValue && z.costTwd !== null;

      const pnl = hasPnL
        ? z.value-z.costTwd
        : null;

      const percent =
        hasValue && totals[type] > 0
          ? z.value/totals[type]*100
          : null;

      const estCount = estimatedTrades(a.id).length;

      return `
        <div class="asset-detail-row">
          <div class="asset-detail-name">
            ${safe(a.name)}
            ${estCount ? ' · 🟡 預估' : ''}
          </div>

          <div class="asset-detail-value">
            ${hasValue ? money(z.value) : '待估值'}
          </div>

          <div class="asset-detail-meta">
            ${hasPnL
              ? `<span class="${pnl < 0 ? 'negative' : 'positive'}">
                   ${money(pnl)}
                 </span>`
              : '損益待確認'}

            ${percent !== null
              ? ` · 類別占比 ${percent.toFixed(1)}%`
              : ''}
          </div>
        </div>
      `;
    }).join('');
  }
}

function renderAllocation(totals) {
  const donut = byId('allocationDonut');
  const legend = byId('allocationLegend');
  const center = byId('allocationCenter');

  if (!donut || !legend || !center) return;

  const total = CATEGORY_ORDER.reduce(
    (sum,type) => sum+Math.max(0,totals[type] || 0),
    0
  );

  if (!(total > 0)) {
    donut.style.background = '#34465e';
    donut.setAttribute(
      'aria-label',
      '尚無可估值資產'
    );
    center.textContent = '待估值';
    legend.innerHTML =
      '<small>尚無可估值的資產配置資料</small>';
    return;
  }

  const segments = [];
  let cumulative = 0;

  for (const type of CATEGORY_ORDER) {
    const value = Math.max(0,totals[type] || 0);
    if (!(value > 0)) continue;

    const start = cumulative/total*100;
    cumulative += value;
    const end = cumulative/total*100;

    segments.push(
      `${CATEGORY_INFO[type].color} `+
      `${start.toFixed(5)}% ${end.toFixed(5)}%`
    );
  }

  donut.style.background =
    `conic-gradient(${segments.join(',')})`;

  donut.setAttribute(
    'aria-label',
    CATEGORY_ORDER.map(type => {
      const pct = (totals[type] || 0)/total*100;
      return `${CATEGORY_INFO[type].name} ${pct.toFixed(1)}%`;
    }).join('、')
  );

  center.textContent = '100%';

  legend.innerHTML = CATEGORY_ORDER.map(type => {
    const info = CATEGORY_INFO[type];
    const value = totals[type] || 0;
    const percent = value/total*100;

    return `
      <div class="allocation-legend-row">
        <span class="allocation-legend-name">
          <span class="allocation-dot"
            style="background:${info.color}"></span>
          ${info.name}
        </span>

        <span class="allocation-legend-value">
          ${percent.toFixed(1)}%
        </span>
      </div>
    `;
  }).join('');
}

function installAssetCardInteractions() {
  document.querySelectorAll('.asset-card').forEach(card => {
    const toggle = () => {
      const isOpen = card.classList.toggle('is-open');
      card.setAttribute(
        'aria-expanded',
        String(isOpen)
      );
    };

    card.addEventListener('click',toggle);

    card.addEventListener('keydown',event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
  });
}

// -------------------------------------
// Main dashboard
// -------------------------------------

function render() {
  let totals = {
    tw:0,
    us:0,
    fund:0,
    crypto:0
  };

  let counts = {
    tw:0,
    us:0,
    fund:0,
    crypto:0
  };

  let v=0;
  let c=0;
  let covered=0;
  let all=0;

  for (const a of state.assets) {
    const z = valuation(a);
    if (z.q <= 0) continue;

    all++;

    if (z.value !== null) {
      totals[a.type] =
        (totals[a.type] || 0)+z.value;

      counts[a.type] =
        (counts[a.type] || 0)+1;

      v += z.value;
      covered++;

      if (z.costTwd !== null) {
        c += z.costTwd;
      }
    }
  }

  byId('total').textContent =
    covered ? money(v) : '尚無可估值資產';

  byId('pnl').textContent =
    covered && c > 0
      ? '可估值部位未實現損益 '+
        money(v-c)+
        '（'+((v/c-1)*100).toFixed(2)+'%）'
      : '損益待確認';

  byId('pnl').className =
    covered && v-c < 0
      ? 'negative'
      : 'positive';

  const estCount =
    state.trades.filter(t => t.estimated).length;

  byId('coverage').textContent =
    `已估值 ${covered}/${all} 檔；未估值部位不計入總額。`+
    `美元成本以目前匯率換算，非實際匯兌損益。期初成本待核對。`+
    (estCount
      ? ` 有 ${estCount} 筆預估入庫，股數及損益可能變動。`
      : '');

  for (const [type,id] of [
    ['tw','twtotal'],
    ['us','ustotal'],
    ['fund','fundtotal'],
    ['crypto','cryptototal']
  ]) {
    byId(id).textContent =
      counts[type] ? money(totals[type]) : '待估值';
  }

  byId('count').textContent =
    covered+' / '+all;

  byId('progresslabel').textContent =
    covered
      ? `${(v/300000*100).toFixed(1)}%（部分估值${estCount ? '・含預估' : ''}）`
      : '—';

  byId('progress').style.width =
    Math.max(
      0,
      Math.min(100,v/300000*100)
    )+'%';

  renderCategoryDetails(totals);
  renderAllocation(totals);
  renderBtcStatus();

  byId('marketinfo').innerHTML =
    state.assets.map(a => {
      const z = valuation(a);

      const btcStatus =
        a.id === 'BTC'
          ? btcQuoteStatus()
          : null;

      const priceTime =
        a.id === 'BTC' &&
        z.p?.automatic
          ? taiwanTime(z.p.retrieved_at)
          : z.p?.date || '日期未知';

      return `
        <div class="item">
          <div class="between">
            <b>${safe(a.name)}</b>
            <small>${safe(priceTime)}</small>
          </div>

          <small>
            ${z.p
              ? money(num(z.p.value),a.currency)+
                ' / 單位 · '+
                safe(z.p.source || '手動')
              : '無法估值'}

            ${a.currency === 'USD' && !fx()
              ? ' · 缺 USD/TWD'
              : ''}
          </small>

          ${btcStatus
            ? `<p class="hint">
                 <span class="${btcStatus.stale ? 'negative' : 'positive'}">
                   ${safe(btcStatus.label)}
                 </span>
                 · ${safe(btcStatus.detail)}
               </p>`
            : ''}
        </div>
      `;
    }).join('');

  byId('holdlist').innerHTML =
    state.assets.map(a => {
      const z = valuation(a);
      const n = estimatedTrades(a.id).length;

      const btcStatus =
        a.id === 'BTC'
          ? btcQuoteStatus()
          : null;

      return `
        <div class="item">
          <div class="between">
            <b>${safe(a.name)}</b>

            <small>
              ${a.type === 'fund'
                ? '基金'
                : a.type === 'us'
                  ? '美股'
                  : a.type === 'crypto'
                    ? '加密貨幣'
                    : '台股'}

              ${n
                ? ' · 🟡 含預估 '+n+' 筆'
                : ''}
            </small>
          </div>

          <p class="muted">
            ${safe(a.id)} ·
            ${a.type === 'crypto'
              ? z.q.toFixed(8)
              : z.q.toFixed(5)}
            單位 · 成本 ${money(z.c,a.currency)}
          </p>

          <div class="between">
            <b>${money(z.value)}</b>
            <small>
              ${z.value !== null && z.costTwd !== null
                ? money(z.value-z.costTwd)
                : '損益待確認'}
            </small>
          </div>

          <small>
            ${z.p
              ? '報價 '+safe(
                  z.p.automatic
                    ? taiwanTime(z.p.retrieved_at)
                    : z.p.date || '未知'
                )
              : '尚未取得價格'}

            · ${a.verified
              ? '已核對'
              : '期初成本待核對'}

            ${n
              ? ' · 預估持倉非券商正式股數'
              : ''}
          </small>

          ${btcStatus
            ? `<p class="hint ${btcStatus.stale ? 'negative' : 'positive'}">
                 ${safe(btcStatus.label)}
               </p>`
            : ''}

          <details>
            <summary>校正期初持倉</summary>

            <label>
              期初數量
              <input type="number" step="any"
                id="q-${safe(a.id)}"
                value="${a.qty}">
            </label>

            <label>
              期初總成本（${a.currency}）
              <input type="number" step="any"
                id="c-${safe(a.id)}"
                value="${a.cost}">
            </label>

            <button onclick="updateBase('${safe(a.id)}')">
              儲存校正
            </button>

            <p class="hint">
              此處只改期初基準，不會清除後續交易。
            </p>
          </details>
        </div>
      `;
    }).join('');

  for (const id of ['tradeasset','manualasset']) {
    const el = byId(id);
    const selected = el.value;

    el.innerHTML = state.assets.map(a =>
      `<option value="${safe(a.id)}">
        ${safe(a.name)}
      </option>`
    ).join('');

    if (state.assets.some(a => a.id === selected)) {
      el.value = selected;
    }
  }

  byId('recordlist').innerHTML =
    state.trades.length
      ? state.trades.slice().reverse().map(t => `
        <div class="item">
          <div class="between">
            <b>
              ${safe(t.asset)} ·
              ${t.side === 'buy' ? '買入' : '賣出'}
              ${t.estimated ? ' · 🟡 預估入庫' : ''}
            </b>

            <button class="secondary"
              onclick="deleteTrade(${t.created})">
              刪除
            </button>
          </div>

          <small>
            ${safe(t.date)} ·
            ${fmtQty(t.qty)} × ${t.price}
            · 費用 ${t.fee}（標的原幣）
          </small>

          ${t.estimated
            ? `<p class="hint">
                 總扣款 ${money(num(t.twdTotal))}
                 · 預估匯率 ${num(t.fxAtEntry).toFixed(4)}
                 · 股數待券商確認
               </p>

               <button class="secondary"
                 onclick="confirmEstimatedTrade(${t.created})">
                 修正／確認入庫
               </button>`
            : ''}
        </div>
      `).join('')
      : '尚無新增交易';

  byId('feeddate').textContent =
    feed.updated_at
      ? '行情檔更新：'+taiwanTime(feed.updated_at)
      : '尚未取得自動行情';

  byId('feedstatus').textContent =
    feedError
      ? '行情讀取失敗'
      : feed.updated_at
        ? '行情已讀取'
        : '行情未就緒';

  updateEstimatePreview();
  renderPendingSummary();
}

// -------------------------------------
// Asset and trade management
// -------------------------------------

function updateBase(id) {
  const a = state.assets.find(x => x.id === id);

  const q = num(byId('q-'+id).value);
  const c = num(byId('c-'+id).value);

  if (
    !a ||
    !Number.isFinite(q) || q < 0 ||
    !Number.isFinite(c) || c < 0
  ) {
    return alert('請填入有效數值');
  }

  a.qty=q;
  a.cost=c;
  a.verified=true;

  save();
  render();
}

function showAddAsset() {
  byId('assetform').classList.toggle('hidden');
}

function addAsset() {
  const id =
    byId('asymbol').value.trim().toUpperCase();

  if (!id || state.assets.some(a => a.id === id)) {
    return alert('代碼空白或已存在');
  }

  state.assets.push({
    id,
    name:byId('aname').value.trim() || id,
    type:byId('atype').value,
    currency:byId('acurrency').value,
    qty:0,
    cost:0,
    verified:true
  });

  save();
  render();
  showAddAsset();
}

function addTrade() {
  const asset = byId('tradeasset').value;
  const side = byId('tradeside').value;
  const date = byId('tradedate').value;

  const qty = num(byId('tradeqty').value);
  const tradePrice = num(byId('tradeprice').value);
  const fee = num(byId('tradefee').value || 0);

  if (
    !date ||
    !(qty > 0) ||
    !(tradePrice > 0) ||
    !Number.isFinite(fee) ||
    fee < 0
  ) {
    return alert('請填入完整有效的交易資料');
  }

  const a = state.assets.find(x => x.id === asset);

  if (!a) return alert('找不到投資標的');

  if (
    side === 'sell' &&
    qty > position(a).q+1e-8
  ) {
    return alert('賣出數量超過持倉');
  }

  state.trades.push({
    asset,
    side,
    date,
    qty,
    price:tradePrice,
    fee,
    created:uniqueTradeId()
  });

  save();
  render();
  alert('交易已儲存');
}

function uniqueTradeId() {
  let id = Date.now();

  while (state.trades.some(t => t.created === id)) {
    id++;
  }

  return id;
}

function deleteTrade(created) {
  if (!confirm('確定刪除這筆交易？')) return;

  state.trades = state.trades.filter(
    t => t.created !== created
  );

  save();
  render();
}

function saveManual() {
  const id = byId('manualasset').value;
  const value = num(byId('manualprice').value);
  const date = byId('manualdate').value;

  if (!(value > 0) || !date) {
    return alert('請填價格與日期');
  }

  state.manual[id] = {
    value,
    date,
    source:'手動輸入'
  };

  save();
  render();

  if (id === 'BTC' && validBtcFeedQuote(feed.prices?.BTC)) {
    alert(
      '手動價格已儲存為備援。' +
      'BTC 目前仍優先使用 BitoPro 自動行情。'
    );
  }
}

function clearManual() {
  delete state.manual[byId('manualasset').value];
  save();
  render();
}

function saveFx() {
  const raw = byId('fx').value;
  const next = raw === '' ? null : num(raw);

  if (next !== null && !(next > 0)) {
    return alert('匯率必須大於 0');
  }

  state.fxOverride=next;
  save();
  render();
}

function exportData() {
  const blob = new Blob([
    JSON.stringify({
      exported_at:new Date().toISOString(),
      ...state
    },null,2)
  ],{
    type:'application/json'
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href=url;
  a.download =
    'wealth-v2-backup-'+
    new Date().toISOString().slice(0,10)+
    '.json';

  a.click();

  setTimeout(() => URL.revokeObjectURL(url),1000);
}

async function importData(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const x = JSON.parse(await file.text());

    if (
      x.version !== 2 ||
      !Array.isArray(x.assets) ||
      !Array.isArray(x.trades)
    ) {
      throw Error('非 V2 備份');
    }

    if (!confirm(
      '確定覆蓋目前 V2 資料？請先備份。'
    )) return;

    state=x;

    if (!state.manual ||
        typeof state.manual !== 'object') {
      state.manual={};
    }

    save();
    render();

  } catch (err) {
    alert('匯入失敗：'+err.message);
  }
}

function resetDemo() {
  if (!confirm(
    '這會清除目前 V2 的持倉與交易，確定嗎？'
  )) return;

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

// -------------------------------------
// Market feed
// -------------------------------------

async function loadFeed(bust=false) {
  try {
    const r = await fetch(
      'market.json'+(bust ? '?t='+Date.now() : ''),
      {cache:'no-store'}
    );

    if (!r.ok) {
      throw Error('行情檔尚未建立');
    }

    const j = await r.json();

    if (
      !j ||
      !j.prices ||
      typeof j.prices !== 'object' ||
      Array.isArray(j.prices)
    ) {
      throw Error('行情格式不正確');
    }

    feed=j;
    feedError=null;

    render();

    window.dispatchEvent(
      new Event('wealth:feed-loaded')
    );

  } catch (e) {
    feedError=e.message;
    render();

    byId('feedstatus').textContent =
      '行情讀取失敗';

    byId('feeddate').textContent =
      e.message;
  }
}

// -------------------------------------
// Estimated USD purchases
// -------------------------------------

function installEstimatedUI() {
  const tradeSelect=byId('tradeasset');

  if (!tradeSelect || byId('estimatePanel')) return;

  const section =
    tradeSelect.closest('section') ||
    tradeSelect.parentElement.parentElement;

  const panel=document.createElement('div');

  panel.id='estimatePanel';
  panel.className='item';

  panel.innerHTML=`
    <h3>🟡 預估入庫（台幣定期定額）</h3>

    <p class="hint">
      已下單／扣款但尚未取得正式股數時使用。
      儲存後立即計入持倉與估值；股數為預估值。
    </p>

    <label>
      總投入金額（TWD，含手續費）
      <input id="estimateTwd" type="number"
        min="0" step="0.01"
        value="24600" inputmode="decimal">
    </label>

    <label>
      手續費率（%）
      <input id="estimateFeeRate" type="number"
        min="0" step="0.001"
        value="0.1" inputmode="decimal">
    </label>

    <label>
      參考 USD/TWD 匯率
      <input id="estimateFx" type="number"
        min="0" step="any"
        placeholder="自動行情匯率，可自行修改"
        inputmode="decimal">
    </label>

    <label>
      參考成交價（USD／股）
      <input id="estimatePrice" type="number"
        min="0" step="any"
        placeholder="自動帶入 VOO 行情，可自行修改"
        inputmode="decimal">
    </label>

    <p id="estimatePreview" class="hint">
      等待參考價格與匯率…
    </p>

    <button id="estimateSave" type="button">
      立即預估入庫
    </button>

    <p class="hint">
      請勿再用上方「儲存交易」重複新增同一筆。
    </p>
  `;

  section.appendChild(panel);

  byId('estimateSave').addEventListener(
    'click',addEstimatedTrade
  );

  for (const id of [
    'estimateTwd',
    'estimateFeeRate',
    'estimateFx',
    'estimatePrice'
  ]) {
    byId(id).addEventListener(
      'input',updateEstimatePreview
    );
  }

  tradeSelect.addEventListener(
    'change',updateEstimatePreview
  );

  byId('tradeside').addEventListener(
    'change',updateEstimatePreview
  );
}

function estimateInputs() {
  const a = state.assets.find(
    x => x.id === byId('tradeasset')?.value
  );

  const total=num(byId('estimateTwd')?.value);
  const feeRate=num(byId('estimateFeeRate')?.value);

  const rate =
    num(byId('estimateFx')?.value) || fx();

  const p =
    num(byId('estimatePrice')?.value) ||
    num(a && price(a)?.value);

  const feeTwd =
    Math.round(total*feeRate/100*100)/100;

  const principal=total-feeTwd;

  return {
    a,total,feeRate,rate,p,feeTwd,principal,
    qty:principal/rate/p,
    feeUsd:feeTwd/rate
  };
}

function updateEstimatePreview() {
  const panel=byId('estimatePanel');
  if (!panel) return;

  const a=state.assets.find(
    x => x.id === byId('tradeasset').value
  );

  const enabled =
    !!a &&
    a.currency === 'USD' &&
    byId('tradeside').value === 'buy';

  panel.style.display=enabled ? '' : 'none';

  if (!enabled) return;

  const rateEl=byId('estimateFx');
  const pEl=byId('estimatePrice');

  if (!rateEl.dataset.userEdited && fx()) {
    rateEl.value=fx();
  }

  const currentPrice=num(price(a)?.value);

  if (!pEl.dataset.userEdited && currentPrice > 0) {
    pEl.value=currentPrice;
  }

  const x=estimateInputs();

  byId('estimatePreview').textContent =
    x.total > 0 &&
    x.feeRate >= 0 &&
    x.principal > 0 &&
    x.rate > 0 &&
    x.p > 0
      ? `手續費 ${money(x.feeTwd)}｜`+
        `買入本金 ${money(x.principal)}｜`+
        `預估 ${fmtQty(x.qty)} 股｜`+
        `匯率 ${x.rate}｜`+
        `參考股價 ${money(x.p,'USD')}`
      : '請填入有效金額、參考匯率與美元股價後即可估算。';
}

function addEstimatedTrade() {
  const x=estimateInputs();
  const date=byId('tradedate').value;

  if (
    !x.a ||
    x.a.currency !== 'USD' ||
    !date ||
    !(x.total > 0) ||
    !(x.feeRate >= 0) ||
    !(x.principal > 0) ||
    !(x.rate > 0) ||
    !(x.p > 0) ||
    !Number.isFinite(x.qty)
  ) {
    return alert(
      '請確認日期、台幣金額、費率、匯率與美元股價'
    );
  }

  const message =
    `將 ${money(x.total)} 記為「預估入庫」？\n`+
    `預估 ${fmtQty(x.qty)} 股 ${x.a.id}。\n`+
    '這會立即增加持倉與預估資產，'+
    '正式成交後可修正原交易。';

  if (!confirm(message)) return;

  state.trades.push({
    asset:x.a.id,
    side:'buy',
    date,
    qty:x.qty,
    price:x.p,
    fee:x.feeUsd,
    created:uniqueTradeId(),
    estimated:true,
    twdTotal:x.total,
    twdFee:x.feeTwd,
    fxAtEntry:x.rate
  });

  save();
  render();

  alert('已預估入庫；請勿重複新增同一筆交易');
}

function confirmEstimatedTrade(created) {
  const t=state.trades.find(
    t => t.created === created && t.estimated
  );

  if (!t) return alert('找不到預估交易');

  const qRaw=prompt(
    '輸入券商實際成交股數（股）：',
    String(t.qty)
  );

  if (qRaw === null) return;

  const pRaw=prompt(
    '輸入實際美元成交均價（USD／股）：',
    String(t.price)
  );

  if (pRaw === null) return;

  const fRaw=prompt(
    '輸入實際交易手續費（USD）：',
    String(t.fee)
  );

  if (fRaw === null) return;

  const q=Number(qRaw);
  const p=Number(pRaw);
  const f=Number(fRaw);

  if (
    !qRaw.trim() ||
    !pRaw.trim() ||
    !fRaw.trim() ||
    !(q > 0) ||
    !(p > 0) ||
    !Number.isFinite(f) ||
    f < 0
  ) {
    return alert(
      '成交股數、價格、手續費必須為有效數值'
    );
  }

  if (!confirm(
    '確認實際股數、成交價與手續費已核對？'+
    '將直接修正原交易，不另新增。'
  )) return;

  t.qty=q;
  t.price=p;
  t.fee=f;
  t.estimated=false;
  t.confirmedAt=new Date().toISOString();

  save();
  render();

  alert('已確認入庫，原交易已更新');
}

function renderPendingSummary() {
  let el=byId('estimatedSummary');

  if (!el) {
    const target=
      byId('total')?.closest('.card') ||
      byId('total')?.parentElement;

    if (!target) return;

    el=document.createElement('div');
    el.id='estimatedSummary';
    el.className='item';

    target.appendChild(el);
  }

  const pending=state.trades.filter(
    t => t.estimated
  );

  if (!pending.length) {
    el.style.display='none';
    return;
  }

  el.style.display='';

  const total=pending.reduce(
    (sum,t) => sum+(num(t.twdTotal) || 0),
    0
  );

  el.innerHTML=`
    <b>🟡 預估入庫 · ${pending.length} 筆</b>

    <p>
      已記入持倉的預估投入：
      ${money(total)}
    </p>

    <small>
      此金額已反映於預估持倉，
      請勿與總資產再相加。
      實際成交股數、匯率及損益仍待券商確認。
    </small>
  `;
}

// -------------------------------------
// Navigation and startup
// -------------------------------------

document.querySelectorAll('[data-tab]').forEach(
  b => b.addEventListener('click',() => {
    document.querySelectorAll('main>section').forEach(
      s => s.classList.toggle(
        'hidden',
        s.id !== b.dataset.tab
      )
    );

    document.querySelectorAll('[data-tab]').forEach(
      x => x.classList.toggle(
        'active',
        x === b
      )
    );

    window.scrollTo(0,0);
  })
);

byId('tradedate').value=today();
byId('manualdate').value=today();

try {
  installEstimatedUI();

  for (const id of [
    'estimateFx',
    'estimatePrice'
  ]) {
    byId(id)?.addEventListener('input',e => {
      e.target.dataset.userEdited='1';
    });
  }

  installAssetCardInteractions();

  render();
  loadFeed();

} catch (e) {
  byId('feedstatus').textContent =
    '程式錯誤：'+e.message;

  alert('WEALTH 啟動失敗：'+e.message);
}
