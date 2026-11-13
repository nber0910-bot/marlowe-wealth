
'use strict';

// MARLOWE WEALTH V26.1113
// History & P/L calendar extension.
// Preserve existing storage and investment records.

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
  assets:initial.map(
    ([id,name,type,currency,qty,cost]) => ({
      id,name,type,currency,qty,cost,
      verified:false
    })
  ),
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

if (
  !state.history ||
  typeof state.history !== 'object' ||
  Array.isArray(state.history)
) {
  state.history = {};
}

if (!Array.isArray(state.history.snapshots)) {
  state.history.snapshots = [];
}

// Preserve existing BTC migration.
// Never automatically add 00713 or VOO transactions.

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
  Number(btcAsset.qty) > 0 ||
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

const save = () =>
  localStorage.setItem(KEY,JSON.stringify(state));

save();

let feed = {
  prices:{},
  fx:null,
  updated_at:null
};

let feedError = null;

const byId = id => document.getElementById(id);
const num = n => Number(n);

const safe = s =>
  String(s ?? '').replace(/[&<>"']/g,c => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  }[c]));

const money = (n,c='TWD') =>
  Number.isFinite(n)
    ? new Intl.NumberFormat('zh-TW',{
        style:'currency',
        currency:c,
        maximumFractionDigits:2
      }).format(n)
    : '待估值';

const fmtQty = n =>
  Number(n).toFixed(8)
    .replace(/0+$/,'')
    .replace(/\.$/,'');

const today = () => {
  const d = new Date();
  return new Date(
    d.getTime() - d.getTimezoneOffset()*60000
  ).toISOString().slice(0,10);
};

const twDate = () =>
  new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Taipei',
    year:'numeric',
    month:'2-digit',
    day:'2-digit'
  }).format(new Date());

const dateValid = d =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(d)) &&
  !Number.isNaN(Date.parse(d+'T00:00:00Z'));

const closeEnough = (a,b) =>
  Math.abs(a-b) < 1e-7;

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

  return Number.isFinite(timestamp) &&
    timestamp <= Date.now()+300000;
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

  return validQuote(fallback)
    ? {...fallback,automatic:false}
    : null;
}

function price(a) {
  return a.id === 'BTC'
    ? btcQuote()
    : state.manual[a.id] ||
      feed.prices?.[a.id] ||
      null;
}

function btcQuoteStatus() {
  const p = btcQuote();

  if (!p) {
    return {
      label:'無可用報價',
      detail:'尚未取得 BTC/TWD 價格',
      stale:true
    };
  }

  if (!p.automatic) {
    return {
      label:'手動參考價',
      detail:'目前使用手動價格，並非即時行情',
      stale:true
    };
  }

  const stale =
    Date.now()-Date.parse(p.retrieved_at) >
    BTC_STALE_HOURS*3600000;

  return {
    label:stale ? '行情已過期' : '自動行情正常',
    detail:stale
      ? '超過 2 小時未取得新報價，仍顯示最後有效價格'
      : 'BitoPro 最近一次成功取得的行情快照',
    stale
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
  const el = byId('btcPriceNote');
  if (!el) return;

  const p = btcQuote();
  const status = btcQuoteStatus();

  if (!p) {
    el.textContent =
      'BTC/TWD 尚無可用價格，等待 BitoPro 自動行情。';
    return;
  }

  el.innerHTML = `
    <b class="${status.stale ? 'negative' : 'positive'}">
      BTC · ${safe(status.label)}
    </b>
    <br>
    ${p.automatic ? 'BitoPro BTC/TWD' : '參考價格'}：
    ${money(Number(p.value))}
    <br>
    ${p.automatic
      ? '擷取時間：'+safe(taiwanTime(p.retrieved_at))
      : '參考日期：'+safe(p.date || '未知')}
    <br>
    ${safe(status.detail)}
  `;
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
      (x.created || 0)-(y.created || 0)
    );

  for (const t of trades) {
    const tq = num(t.qty) || 0;
    const tp = num(t.price) || 0;
    const tf = num(t.fee) || 0;

    if (t.side === 'buy') {
      q += tq;
      c += tq*tp+tf;
    } else if (
      t.side === 'sell' &&
      tq <= q+1e-8
    ) {
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

  const rate = a.currency === 'USD'
    ? fx()
    : 1;

  const valid =
    q > 0 &&
    validQuote(p) &&
    rate > 0;

  return {
    q,c,p,
    value:valid
      ? q*num(p.value)*rate
      : null,
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

const CATEGORY_ORDER = [
  'tw','us','fund','crypto'
];

const CATEGORY_INFO = {
  tw:{
    name:'台股 ETF',
    color:'#83b8ff'
  },
  us:{
    name:'美股 ETF',
    color:'#83d9c1'
  },
  fund:{
    name:'基金',
    color:'#c5a4ff'
  },
  crypto:{
    name:'加密貨幣',
    color:'#f2bd74'
  }
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
    const el = byId(type+'details');
    if (!el) continue;

    const rows = categoryRows(type);

    el.innerHTML = rows.length
      ? rows.map(z => {
          const a = z.asset;

          const pnl =
            z.value !== null &&
            z.costTwd !== null
              ? z.value-z.costTwd
              : null;

          const pct =
            z.value !== null &&
            totals[type] > 0
              ? z.value/totals[type]*100
              : null;

          return `
            <div class="asset-detail-row">
              <div class="asset-detail-name">
                ${safe(a.name)}
                ${estimatedTrades(a.id).length
                  ? ' · 🟡 預估'
                  : ''}
              </div>

              <div class="asset-detail-value">
                ${z.value !== null
                  ? money(z.value)
                  : '待估值'}
              </div>

              <div class="asset-detail-meta">
                ${pnl === null
                  ? '損益待確認'
                  : `<span class="${pnl < 0
                      ? 'negative'
                      : 'positive'}">
                      ${money(pnl)}
                    </span>`}

                ${pct === null
                  ? ''
                  : ` · 類別占比 ${pct.toFixed(1)}%`}
              </div>
            </div>
          `;
        }).join('')
      : '<p class="hint">目前沒有持倉</p>';
  }
}

function renderAllocation(totals) {
  const donut = byId('allocationDonut');
  const legend = byId('allocationLegend');
  const center = byId('allocationCenter');

  if (!donut || !legend || !center) return;

  const total = CATEGORY_ORDER.reduce(
    (sum,type) =>
      sum+Math.max(0,totals[type] || 0),
    0
  );

  if (!(total > 0)) {
    donut.style.background = '#34465e';
    donut.setAttribute(
      'aria-label','尚無可估值資產'
    );
    center.textContent = '待估值';
    legend.innerHTML =
      '<small>尚無可估值的資產配置資料</small>';
    return;
  }

  let cumulative = 0;
  const segments = [];

  for (const type of CATEGORY_ORDER) {
    const value = Math.max(
      0,totals[type] || 0
    );

    if (!value) continue;

    const start = cumulative/total*100;
    cumulative += value;

    segments.push(
      `${CATEGORY_INFO[type].color} `+
      `${start.toFixed(5)}% `+
      `${(cumulative/total*100).toFixed(5)}%`
    );
  }

  donut.style.background =
    `conic-gradient(${segments.join(',')})`;

  donut.setAttribute(
    'aria-label',
    CATEGORY_ORDER.map(type =>
      `${CATEGORY_INFO[type].name} `+
      `${((totals[type] || 0)/total*100).toFixed(1)}%`
    ).join('、')
  );

  center.textContent = '100%';

  legend.innerHTML = CATEGORY_ORDER.map(type => `
    <div class="allocation-legend-row">
      <span class="allocation-legend-name">
        <span class="allocation-dot"
          style="background:${CATEGORY_INFO[type].color}">
        </span>
        ${CATEGORY_INFO[type].name}
      </span>

      <span class="allocation-legend-value">
        ${((totals[type] || 0)/total*100).toFixed(1)}%
      </span>
    </div>
  `).join('');
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
      if (
        event.key === 'Enter' ||
        event.key === ' '
      ) {
        event.preventDefault();
        toggle();
      }
    });
  });
}

// END OF PART 1

// =====================================
// PART 2 — 損益日曆與投資歷程
// =====================================

// 歷史快照是網站實際觀測值，
// 並非交易所官方每日收盤資料。
// 不倒填過去日期，也不虛構損益。

function snapshotCandidate() {
  if (!feed.updated_at) return null;

  let value = 0;
  let cost = 0;
  let covered = 0;
  let all = 0;

  const positions = {};

  for (const a of state.assets) {
    const z = valuation(a);

    if (z.q <= 0) continue;

    all++;

    if (
      z.value === null ||
      z.costTwd === null
    ) {
      continue;
    }

    covered++;
    value += z.value;
    cost += z.costTwd;

    positions[a.id] = {
      q:z.q,
      c:z.c,
      currency:a.currency
    };
  }

  if (
    !all ||
    covered !== all ||
    !Number.isFinite(value) ||
    !Number.isFinite(cost)
  ) {
    return null;
  }

  return {
    date:twDate(),
    observedAt:new Date().toISOString(),
    value,
    cost,
    unrealized:value-cost,
    positions,
    fx:fx(),
    coverage:covered
  };
}

function recordSnapshot() {
  const s = snapshotCandidate();
  if (!s) return;

  const arr = state.history.snapshots;
  const i = arr.findIndex(x => x.date === s.date);

  if (i >= 0) {
    const old = arr[i];

    if (
      old.observedAt &&
      old.observedAt > s.observedAt
    ) {
      return;
    }

    arr[i] = s;
  } else {
    arr.push(s);
  }

  arr.sort((a,b) =>
    String(a.date).localeCompare(String(b.date))
  );

  save();
}

function samePositions(a,b) {
  if (!a || !b) return false;

  const ka = Object.keys(a);
  const kb = Object.keys(b);

  return (
    ka.length === kb.length &&
    ka.every(k =>
      b[k] &&
      closeEnough(Number(a[k].q),Number(b[k].q)) &&
      closeEnough(Number(a[k].c),Number(b[k].c)) &&
      a[k].currency === b[k].currency
    )
  );
}

function dateAfter(d) {
  const x = new Date(d+'T00:00:00Z');
  x.setUTCDate(x.getUTCDate()+1);
  return x.toISOString().slice(0,10);
}

function dailyChanges() {
  const arr = state.history.snapshots
    .slice()
    .filter(x => dateValid(x.date))
    .sort((a,b) => a.date.localeCompare(b.date));

  const map = {};

  for (let i=1;i<arr.length;i++) {
    const previous = arr[i-1];
    const current = arr[i];

    if (
      dateAfter(previous.date) !== current.date
    ) {
      continue;
    }

    if (
      !samePositions(
        previous.positions,
        current.positions
      )
    ) {
      continue;
    }

    const amount =
      Number(current.unrealized) -
      Number(previous.unrealized);

    const pct = previous.value > 0
      ? amount/previous.value*100
      : null;

    if (Number.isFinite(amount)) {
      map[current.date] = {
        amount,
        pct,
        previous,
        current
      };
    }
  }

  return map;
}

// -------------------------------------
// 損益日曆
// -------------------------------------

let calendarDate = new Date();
let calendarMode = 'daily';
let calendarSelected = null;

function setCalendarMonth(offset) {
  calendarDate = new Date(
    calendarDate.getFullYear(),
    calendarDate.getMonth()+offset,
    1
  );

  calendarSelected = null;
  renderCalendar();
}

function calendarSigned(n) {
  return (n>0 ? '+' : '')+money(n);
}

// 台灣慣例：紅漲綠跌。
// 原本 CSS 的 negative 是紅色，positive 是綠色。

function calendarTone(n) {
  return n>0
    ? 'negative'
    : n<0
      ? 'positive'
      : '';
}

function renderCalendar() {
  const grid = byId('calendarGrid');
  if (!grid) return;

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();

  const prefix =
    `${year}-${String(month+1).padStart(2,'0')}`;

  const changes = dailyChanges();

  byId('calendarMonth').textContent =
    `${year} 年 ${month+1} 月`;

  const first = new Date(year,month,1);
  const last = new Date(year,month+1,0).getDate();

  const offset = (first.getDay()+6)%7;

  const rows = [];

  const totalCells =
    Math.ceil((offset+last)/7)*7;

  for (
    let start=0;
    start<totalCells;
    start+=7
  ) {
    const days = [];

    for (let j=0;j<7;j++) {
      const n = start+j-offset+1;

      days.push(
        n>=1 && n<=last ? n : null
      );
    }

    rows.push(days);
  }

  const monthEntries =
    Object.entries(changes).filter(
      ([d]) => d.startsWith(prefix)
    );

  const monthAmount =
    monthEntries.reduce(
      (sum,[,x]) => sum+x.amount,
      0
    );

  const monthPnl = byId('calendarMonthPnl');

  monthPnl.textContent =
    monthEntries.length
      ? calendarSigned(monthAmount)
      : '—';

  monthPnl.className =
    monthEntries.length
      ? calendarTone(monthAmount)
      : '';

  // 缺少完整月份資料時，不顯示不可靠的報酬率。
  byId('calendarMonthReturn').textContent = '—';

  let cumulative = 0;

  let html = [
    '一','二','三','四','五','週損益'
  ].map(s =>
    `<div class="calendar-head">${s}</div>`
  ).join('');

  for (const days of rows) {
    let weekAmount = 0;
    let weekCount = 0;

    for (let j=0;j<5;j++) {
      const n = days[j];

      if (!n) {
        html +=
          '<div class="calendar-cell empty"></div>';
        continue;
      }

      const d =
        `${prefix}-${String(n).padStart(2,'0')}`;

      const x = changes[d];

      if (x) {
        weekAmount += x.amount;
        weekCount++;
      }

      if (
        x &&
        calendarMode === 'cumulative'
      ) {
        cumulative += x.amount;
      }

      const shown = x
        ? calendarMode === 'daily'
          ? x.amount
          : cumulative
        : null;

      const amountText =
        shown === null
          ? '—'
          : (shown>0 ? '+' : '')+
            Math.round(shown).toLocaleString('zh-TW');

      const percentText =
        x &&
        calendarMode === 'daily' &&
        x.pct !== null
          ? (x.pct>0 ? '+' : '')+
            x.pct.toFixed(2)+'%'
          : '';

      html += `
        <button
          type="button"
          class="calendar-cell
            ${d===twDate() ? 'today' : ''}
            ${d===calendarSelected ? 'selected' : ''}"
          data-calendar-day="${d}"
          style="color:inherit;cursor:pointer"
        >
          <span class="calendar-day">
            ${n}
          </span>

          <span class="calendar-amount
            ${shown===null ? '' : calendarTone(shown)}">
            ${amountText}
          </span>

          <span class="calendar-percent">
            ${percentText}
          </span>
        </button>
      `;
    }

    // 週末雖不單獨顯示，
    // 已有的觀測變動仍計入週統計。

    const extra = [
      days[5],
      days[6]
    ].map(n =>
      n
        ? changes[
            `${prefix}-${String(n).padStart(2,'0')}`
          ]
        : null
    );

    for (const x of extra) {
      if (x) {
        weekAmount += x.amount;
        weekCount++;
      }
    }

    const weekText = weekCount
      ? (weekAmount>0 ? '+' : '')+
        Math.round(weekAmount).toLocaleString('zh-TW')
      : '—';

    html += `
      <div class="calendar-cell week-total">
        <span class="calendar-day">
          週損益
        </span>

        <span class="calendar-amount
          ${weekCount ? calendarTone(weekAmount) : ''}">
          ${weekText}
        </span>
      </div>
    `;
  }

  grid.innerHTML = html;

  grid.querySelectorAll(
    '[data-calendar-day]'
  ).forEach(button => {
    button.addEventListener('click',() => {
      calendarSelected =
        button.dataset.calendarDay;

      renderCalendar();
    });
  });

  const detail = byId('calendarDetail');

  if (detail) {
    const x = calendarSelected
      ? changes[calendarSelected]
      : null;

    detail.innerHTML = `
      <h3>
        ${calendarSelected
          ? safe(calendarSelected)+' · '
          : '每日'}
        損益明細
      </h3>
    ` + (
      x
        ? `
          <p class="${calendarTone(x.amount)}">
            ${calendarSigned(x.amount)}
            ${x.pct===null
              ? ''
              : `（${x.pct.toFixed(2)}%）`}
          </p>

          <p class="hint">
            前一日觀測：
            ${money(x.previous.value)}
            <br>
            當日觀測：
            ${money(x.current.value)}
            <br>
            持倉及成本未變，
            以未實現損益差額計算。
            非券商官方日結。
          </p>
        `
        : `
          <p class="hint">
            此日期沒有可比較的連續兩日完整估值，
            或期間持倉／成本發生變化。
          </p>
        `
    );
  }

  byId('calendarNote').textContent =
    '日曆使用開啟網站時保存的行情觀測快照；'+
    '只計算連續兩日且持倉及成本未變的'+
    '未實現損益差額。週／月金額僅加總有資料的日期，'+
    '並非完整期間報酬。週末若有 BTC 變動，'+
    '週損益可能包含未單獨顯示的週末觀測。';
}

function installCalendar() {
  byId('calendarPrev')?.addEventListener(
    'click',
    () => setCalendarMonth(-1)
  );

  byId('calendarNext')?.addEventListener(
    'click',
    () => setCalendarMonth(1)
  );

  byId('calendarDailyMode')?.addEventListener(
    'click',
    () => {
      calendarMode = 'daily';

      byId('calendarDailyMode')
        .classList.add('active');

      byId('calendarCumulativeMode')
        .classList.remove('active');

      renderCalendar();
    }
  );

  byId('calendarCumulativeMode')?.addEventListener(
    'click',
    () => {
      calendarMode = 'cumulative';

      byId('calendarCumulativeMode')
        .classList.add('active');

      byId('calendarDailyMode')
        .classList.remove('active');

      renderCalendar();
    }
  );
}

// -------------------------------------
// 投資歷程與日期分類
// -------------------------------------

function renderHistory() {
  const yearEl = byId('recordYearFilter');
  const monthEl = byId('recordMonthFilter');
  const typeEl = byId('recordTypeFilter');

  if (!yearEl || !monthEl || !typeEl) {
    return;
  }

  const selectedYear = yearEl.value;

  const years = [
    ...new Set(
      state.trades
        .map(t => String(t.date || '').slice(0,4))
        .filter(s => /^\d{4}$/.test(s))
    )
  ].sort().reverse();

  yearEl.innerHTML =
    '<option value="all">全部年份</option>'+
    years.map(v =>
      `<option value="${v}">${v} 年</option>`
    ).join('');

  yearEl.value =
    years.includes(selectedYear)
      ? selectedYear
      : 'all';

  const rows = state.trades.filter(t => {
    const yearMatch =
      yearEl.value === 'all' ||
      String(t.date).startsWith(
        yearEl.value+'-'
      );

    const monthMatch =
      monthEl.value === 'all' ||
      String(t.date).slice(5,7) === monthEl.value;

    const typeMatch =
      typeEl.value === 'all' ||
      (
        typeEl.value === 'estimated'
          ? t.estimated === true
          : typeEl.value === 'opening'
            ? false
            : t.side === typeEl.value
      );

    return yearMatch &&
      monthMatch &&
      typeMatch;
  }).sort((a,b) =>
    String(b.date).localeCompare(String(a.date)) ||
    (b.created || 0)-(a.created || 0)
  );

  const list = byId('recordlist');

  if (list) {
    list.innerHTML = rows.length
      ? rows.map(t => {
          const a = state.assets.find(
            x => x.id === t.asset
          );

          const currency = a?.currency || 'TWD';

          return `
            <div class="item">
              <div class="between">
                <b>
                  ${safe(t.asset)} ·
                  ${t.side==='buy' ? '買入' : '賣出'}
                  ${t.estimated
                    ? ' · 🟡 預估入庫'
                    : ''}
                </b>

                <button class="secondary"
                  onclick="deleteTrade(${Number(t.created)})">
                  刪除
                </button>
              </div>

              <small>
                ${safe(t.date || '日期待補')}
                · ${fmtQty(t.qty)}
                × ${money(Number(t.price),currency)}
                · 費用
                ${money(Number(t.fee)||0,currency)}
              </small>

              ${t.estimated
                ? `
                  <p class="hint">
                    總扣款
                    ${money(Number(t.twdTotal))}
                    · 預估匯率
                    ${Number(t.fxAtEntry).toFixed(4)}
                    · 股數待券商確認
                  </p>

                  <button class="secondary"
                    onclick="confirmEstimatedTrade(${Number(t.created)})">
                    修正／確認入庫
                  </button>
                `
                : ''}
            </div>
          `;
        }).join('')
      : `
        <p class="history-empty">
          此篩選條件下沒有已記錄交易
        </p>
      `;
  }

  // 期初持倉與新增交易分開，
  // 避免同一筆投資重複計算。

  const opening = state.assets.filter(
    a => Number(a.qty)>0
  );

  const openingEl = byId('openingHistoryList');

  if (openingEl) {
    openingEl.innerHTML = opening.length
      ? opening.map(a => `
          <div class="history-entry">
            <div class="between">
              <b>${safe(a.name)}</b>
              <span class="history-unknown">
                日期待補
              </span>
            </div>

            <small>
              ${fmtQty(a.qty)} 單位
              · 期初成本
              ${money(Number(a.cost),a.currency)}
            </small>
          </div>
        `).join('')
      : `
        <p class="hint">
          目前沒有期初持倉
        </p>
      `;
  }

  const totalCost = state.assets.reduce(
    (sum,a) => {
      const z = valuation(a);
      return sum+(z.costTwd ?? 0);
    },
    0
  );

  byId('historyTotalCost').textContent =
    money(totalCost);

  byId('historyTradeCount').textContent =
    state.trades.length+' 筆';

  byId('historyUnknownCount').textContent =
    opening.length+' 檔';

  const thisMonth = twDate().slice(0,7);

  let known = 0;
  let uncertain = 0;

  for (const t of state.trades) {
    if (
      !String(t.date).startsWith(thisMonth) ||
      t.side !== 'buy'
    ) {
      continue;
    }

    const a = state.assets.find(
      x => x.id === t.asset
    );

    if (!a) continue;

    if (a.currency === 'TWD') {
      known +=
        Number(t.qty)*Number(t.price)+
        (Number(t.fee)||0);
    } else if (
      Number.isFinite(Number(t.twdTotal)) &&
      Number(t.twdTotal)>0
    ) {
      known += Number(t.twdTotal);
    } else {
      uncertain++;
    }
  }

  byId('historyMonthInput').textContent =
    money(known)+
    (uncertain ? '（另有待核對）' : '');

  const hint = byId('historyMonthInput')
    .closest('.card');

  if (hint) {
    hint.title =
      '此處為已記錄的本月買入金額，'+
      '不等於本月外部淨存入；'+
      '期初持倉不計入。';
  }
}

function installHistoryFilters() {
  for (const id of [
    'recordYearFilter',
    'recordMonthFilter',
    'recordTypeFilter'
  ]) {
    byId(id)?.addEventListener(
      'change',
      renderHistory
    );
  }
}

// END OF PART 2

// =====================================
// PART 3 — Dashboard, Trades & Startup
// =====================================

// -------------------------------------
// Main dashboard
// -------------------------------------

function render() {
  const totals = {
    tw:0,
    us:0,
    fund:0,
    crypto:0
  };

  const counts = {
    tw:0,
    us:0,
    fund:0,
    crypto:0
  };

  let v = 0;
  let c = 0;
  let covered = 0;
  let all = 0;

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

  const pnl = v-c;

  byId('pnl').textContent =
    covered && c > 0
      ? '可估值部位未實現損益 '+
        money(pnl)+
        '（'+((v/c-1)*100).toFixed(2)+'%）'
      : '損益待確認';

  byId('pnl').className =
    covered && pnl < 0
      ? 'negative'
      : 'positive';

  const estCount = state.trades.filter(
    t => t.estimated
  ).length;

  byId('coverage').textContent =
    `已估值 ${covered}/${all} 檔；`+
    '未估值部位不計入總額。'+
    '美元成本以目前匯率換算，'+
    '非實際匯兌損益。期初成本待核對。'+
    (estCount
      ? ` 有 ${estCount} 筆預估入庫，`+
        '股數及損益可能變動。'
      : '');

  for (const [type,id] of [
    ['tw','twtotal'],
    ['us','ustotal'],
    ['fund','fundtotal'],
    ['crypto','cryptototal']
  ]) {
    byId(id).textContent =
      counts[type]
        ? money(totals[type])
        : '待估值';
  }

  byId('count').textContent =
    covered+' / '+all;

  byId('progresslabel').textContent =
    covered
      ? `${(v/300000*100).toFixed(1)}%`+
        `（部分估值${estCount ? '・含預估' : ''}）`
      : '—';

  byId('progress').style.width =
    Math.max(
      0,
      Math.min(100,v/300000*100)
    )+'%';

  renderCategoryDetails(totals);
  renderAllocation(totals);
  renderBtcStatus();

  renderMarketInfo();
  renderHoldings();
  renderAssetSelectors();

  byId('feeddate').textContent =
    feed.updated_at
      ? '行情檔更新：'+
        taiwanTime(feed.updated_at)
      : '尚未取得自動行情';

  byId('feedstatus').textContent =
    feedError
      ? '行情讀取失敗'
      : feed.updated_at
        ? '行情已讀取'
        : '行情未就緒';

  updateEstimatePreview();
  renderPendingSummary();

  renderHistory();
  renderCalendar();
}

// -------------------------------------
// Market information
// -------------------------------------

function renderMarketInfo() {
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
            ? `
              <p class="hint">
                <span class="${btcStatus.stale
                  ? 'negative'
                  : 'positive'}">
                  ${safe(btcStatus.label)}
                </span>
                · ${safe(btcStatus.detail)}
              </p>
            `
            : ''}
        </div>
      `;
    }).join('');
}

// -------------------------------------
// Holdings
// -------------------------------------

function renderHoldings() {
  byId('holdlist').innerHTML =
    state.assets.map(a => {
      const z = valuation(a);
      const n = estimatedTrades(a.id).length;

      const btcStatus =
        a.id === 'BTC'
          ? btcQuoteStatus()
          : null;

      const typeName =
        a.type === 'fund'
          ? '基金'
          : a.type === 'us'
            ? '美股'
            : a.type === 'crypto'
              ? '加密貨幣'
              : '台股';

      return `
        <div class="item">
          <div class="between">
            <b>${safe(a.name)}</b>

            <small>
              ${typeName}
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
            單位 · 成本
            ${money(z.c,a.currency)}
          </p>

          <div class="between">
            <b>${money(z.value)}</b>

            <small>
              ${z.value !== null &&
                z.costTwd !== null
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
            ? `
              <p class="hint ${btcStatus.stale
                ? 'negative'
                : 'positive'}">
                ${safe(btcStatus.label)}
              </p>
            `
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
              期初總成本（${safe(a.currency)}）
              <input type="number" step="any"
                id="c-${safe(a.id)}"
                value="${a.cost}">
            </label>

            <button
              onclick="updateBase('${safe(a.id)}')">
              儲存校正
            </button>

            <p class="hint">
              此處只改期初基準，
              不會清除後續交易。
            </p>
          </details>
        </div>
      `;
    }).join('');
}

function renderAssetSelectors() {
  for (const id of [
    'tradeasset',
    'manualasset'
  ]) {
    const el = byId(id);
    if (!el) continue;

    const selected = el.value;

    el.innerHTML = state.assets.map(a => `
      <option value="${safe(a.id)}">
        ${safe(a.name)}
      </option>
    `).join('');

    if (
      state.assets.some(
        a => a.id === selected
      )
    ) {
      el.value = selected;
    }
  }
}

// -------------------------------------
// Asset and trade management
// -------------------------------------

function updateBase(id) {
  const a = state.assets.find(
    x => x.id === id
  );

  const q = num(byId('q-'+id)?.value);
  const c = num(byId('c-'+id)?.value);

  if (
    !a ||
    !Number.isFinite(q) ||
    q < 0 ||
    !Number.isFinite(c) ||
    c < 0
  ) {
    return alert('請填入有效數值');
  }

  a.qty = q;
  a.cost = c;
  a.verified = true;

  save();
  render();
}

function showAddAsset() {
  byId('assetform').classList.toggle('hidden');
}

function addAsset() {
  const id = byId('asymbol')
    .value.trim().toUpperCase();

  if (
    !id ||
    state.assets.some(a => a.id === id)
  ) {
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

function uniqueTradeId() {
  let id = Date.now();

  while (
    state.trades.some(
      t => t.created === id
    )
  ) {
    id++;
  }

  return id;
}

function addTrade() {
  const asset = byId('tradeasset').value;
  const side = byId('tradeside').value;
  const date = byId('tradedate').value;

  const qty = num(byId('tradeqty').value);
  const tradePrice = num(
    byId('tradeprice').value
  );

  const fee = num(
    byId('tradefee').value || 0
  );

  if (
    !date ||
    !(qty > 0) ||
    !(tradePrice > 0) ||
    !Number.isFinite(fee) ||
    fee < 0
  ) {
    return alert(
      '請填入完整有效的交易資料'
    );
  }

  const a = state.assets.find(
    x => x.id === asset
  );

  if (!a) {
    return alert('找不到投資標的');
  }

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

function deleteTrade(created) {
  if (!confirm(
    '確定刪除這筆交易？'
  )) return;

  state.trades = state.trades.filter(
    t => t.created !== created
  );

  save();
  render();
}

// -------------------------------------
// Manual prices and FX
// -------------------------------------

function saveManual() {
  const id = byId('manualasset').value;
  const value = num(
    byId('manualprice').value
  );

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

  if (
    id === 'BTC' &&
    validBtcFeedQuote(feed.prices?.BTC)
  ) {
    alert(
      '手動價格已儲存為備援。'+
      'BTC 目前仍優先使用 BitoPro 自動行情。'
    );
  }
}

function clearManual() {
  delete state.manual[
    byId('manualasset').value
  ];

  save();
  render();
}

function saveFx() {
  const raw = byId('fx').value;

  const next =
    raw === '' ? null : num(raw);

  if (
    next !== null &&
    !(next > 0)
  ) {
    return alert('匯率必須大於 0');
  }

  state.fxOverride = next;

  save();
  render();
}

// -------------------------------------
// Backup and import
// -------------------------------------

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

  a.href = url;

  a.download =
    'wealth-v2-backup-'+
    new Date().toISOString().slice(0,10)+
    '.json';

  a.click();

  setTimeout(
    () => URL.revokeObjectURL(url),
    1000
  );
}

async function importData(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const x = JSON.parse(
      await file.text()
    );

    if (
      x.version !== 2 ||
      !Array.isArray(x.assets) ||
      !Array.isArray(x.trades)
    ) {
      throw Error('非 V2 備份');
    }

    if (!confirm(
      '確定覆蓋目前 V2 資料？'+
      '請先備份。'
    )) return;

    state = x;

    if (
      !state.manual ||
      typeof state.manual !== 'object'
    ) {
      state.manual = {};
    }

    if (
      !state.history ||
      typeof state.history !== 'object' ||
      Array.isArray(state.history)
    ) {
      state.history = {};
    }

    if (
      !Array.isArray(state.history.snapshots)
    ) {
      state.history.snapshots = [];
    }

    save();
    render();

    alert('資料匯入成功');

  } catch (err) {
    alert(
      '匯入失敗：'+err.message
    );
  } finally {
    e.target.value = '';
  }
}

function resetDemo() {
  if (!confirm(
    '這會清除目前 V2 的持倉與交易，確定嗎？'
  )) return;

  state = {
    version:2,
    assets:[],
    trades:[],
    manual:{},
    fxOverride:null,
    history:{
      snapshots:[]
    }
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
      'market.json'+
      (bust ? '?t='+Date.now() : ''),
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

    feed = j;
    feedError = null;

    // Only record an actual observed snapshot.
    // Never fabricate historical values.
    recordSnapshot();

    render();

    window.dispatchEvent(
      new Event('wealth:feed-loaded')
    );

  } catch (e) {
    feedError = e.message;

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
  const tradeSelect = byId('tradeasset');

  if (
    !tradeSelect ||
    byId('estimatePanel')
  ) return;

  const section =
    tradeSelect.closest('section') ||
    tradeSelect.parentElement.parentElement;

  const panel = document.createElement('div');

  panel.id = 'estimatePanel';
  panel.className = 'item';

  panel.innerHTML = `
    <h3>🟡 預估入庫（台幣定期定額）</h3>

    <p class="hint">
      已下單／扣款但尚未取得正式股數時使用。
      儲存後立即計入持倉與估值；
      股數為預估值。
    </p>

    <label>
      總投入金額（TWD，含手續費）
      <input id="estimateTwd"
        type="number"
        min="0"
        step="0.01"
        value="24600"
        inputmode="decimal">
    </label>

    <label>
      手續費率（%）
      <input id="estimateFeeRate"
        type="number"
        min="0"
        step="0.001"
        value="0.1"
        inputmode="decimal">
    </label>

    <label>
      參考 USD/TWD 匯率
      <input id="estimateFx"
        type="number"
        min="0"
        step="any"
        placeholder="自動行情匯率，可自行修改"
        inputmode="decimal">
    </label>

    <label>
      參考成交價（USD／股）
      <input id="estimatePrice"
        type="number"
        min="0"
        step="any"
        placeholder="自動帶入行情，可自行修改"
        inputmode="decimal">
    </label>

    <p id="estimatePreview" class="hint">
      等待參考價格與匯率…
    </p>

    <button id="estimateSave" type="button">
      立即預估入庫
    </button>

    <p class="hint">
      請勿再用上方「儲存交易」
      重複新增同一筆。
    </p>
  `;

  section.appendChild(panel);

  byId('estimateSave').addEventListener(
    'click',
    addEstimatedTrade
  );

  for (const id of [
    'estimateTwd',
    'estimateFeeRate',
    'estimateFx',
    'estimatePrice'
  ]) {
    byId(id).addEventListener(
      'input',
      updateEstimatePreview
    );
  }

  tradeSelect.addEventListener(
    'change',
    updateEstimatePreview
  );

  byId('tradeside').addEventListener(
    'change',
    updateEstimatePreview
  );
}

function estimateInputs() {
  const a = state.assets.find(
    x => x.id ===
      byId('tradeasset')?.value
  );

  const total = num(
    byId('estimateTwd')?.value
  );

  const feeRate = num(
    byId('estimateFeeRate')?.value
  );

  const rate =
    num(byId('estimateFx')?.value) ||
    fx();

  const p =
    num(byId('estimatePrice')?.value) ||
    num(a && price(a)?.value);

  const feeTwd =
    Math.round(
      total*feeRate/100*100
    )/100;

  const principal = total-feeTwd;

  return {
    a,
    total,
    feeRate,
    rate,
    p,
    feeTwd,
    principal,
    qty:principal/rate/p,
    feeUsd:feeTwd/rate
  };
}

function updateEstimatePreview() {
  const panel = byId('estimatePanel');
  if (!panel) return;

  const a = state.assets.find(
    x => x.id ===
      byId('tradeasset').value
  );

  const enabled =
    !!a &&
    a.currency === 'USD' &&
    byId('tradeside').value === 'buy';

  panel.style.display =
    enabled ? '' : 'none';

  if (!enabled) return;

  const rateEl = byId('estimateFx');
  const pEl = byId('estimatePrice');

  if (
    !rateEl.dataset.userEdited &&
    fx()
  ) {
    rateEl.value = fx();
  }

  const currentPrice =
    num(price(a)?.value);

  if (
    !pEl.dataset.userEdited &&
    currentPrice > 0
  ) {
    pEl.value = currentPrice;
  }

  const x = estimateInputs();

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
      : '請填入有效金額、參考匯率'+
        '與美元股價後即可估算。';
}

function addEstimatedTrade() {
  const x = estimateInputs();
  const date = byId('tradedate').value;

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
      '請確認日期、台幣金額、'+
      '費率、匯率與美元股價'
    );
  }

  const message =
    `將 ${money(x.total)} `+
    '記為「預估入庫」？\n'+
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

  alert(
    '已預估入庫；'+
    '請勿重複新增同一筆交易'
  );
}

function confirmEstimatedTrade(created) {
  const t = state.trades.find(
    t =>
      t.created === created &&
      t.estimated
  );

  if (!t) {
    return alert('找不到預估交易');
  }

  const qRaw = prompt(
    '輸入券商實際成交股數（股）：',
    String(t.qty)
  );

  if (qRaw === null) return;

  const pRaw = prompt(
    '輸入實際美元成交均價（USD／股）：',
    String(t.price)
  );

  if (pRaw === null) return;

  const fRaw = prompt(
    '輸入實際交易手續費（USD）：',
    String(t.fee)
  );

  if (fRaw === null) return;

  const q = Number(qRaw);
  const p = Number(pRaw);
  const f = Number(fRaw);

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
      '成交股數、價格、'+
      '手續費必須為有效數值'
    );
  }

  if (!confirm(
    '確認實際股數、成交價與手續費已核對？'+
    '將直接修正原交易，不另新增。'
  )) return;

  t.qty = q;
  t.price = p;
  t.fee = f;
  t.estimated = false;
  t.confirmedAt =
    new Date().toISOString();

  save();
  render();

  alert(
    '已確認入庫，原交易已更新'
  );
}

function renderPendingSummary() {
  let el = byId('estimatedSummary');

  if (!el) {
    const target =
      byId('total')?.closest('.card') ||
      byId('total')?.parentElement;

    if (!target) return;

    el = document.createElement('div');
    el.id = 'estimatedSummary';
    el.className = 'item';

    target.appendChild(el);
  }

  const pending = state.trades.filter(
    t => t.estimated
  );

  if (!pending.length) {
    el.style.display = 'none';
    return;
  }

  el.style.display = '';

  const total = pending.reduce(
    (sum,t) =>
      sum+(num(t.twdTotal) || 0),
    0
  );

  el.innerHTML = `
    <b>
      🟡 預估入庫 ·
      ${pending.length} 筆
    </b>

    <p>
      已記入持倉的預估投入：
      ${money(total)}
    </p>

    <small>
      此金額已反映於預估持倉，
      請勿與總資產再相加。
      實際成交股數、匯率及損益
      仍待券商確認。
    </small>
  `;
}

// -------------------------------------
// Navigation
// -------------------------------------

function installNavigation() {
  document.querySelectorAll(
    '[data-tab]'
  ).forEach(b => {
    b.addEventListener('click',() => {
      document.querySelectorAll(
        'main>section'
      ).forEach(s => {
        s.classList.toggle(
          'hidden',
          s.id !== b.dataset.tab
        );
      });

      document.querySelectorAll(
        '[data-tab]'
      ).forEach(x => {
        x.classList.toggle(
          'active',
          x === b
        );
      });

      window.scrollTo(0,0);
    });
  });
}

// -------------------------------------
// Startup
// -------------------------------------

try {
  installNavigation();

  byId('tradedate').value = today();
  byId('manualdate').value = today();

  installEstimatedUI();

  for (const id of [
    'estimateFx',
    'estimatePrice'
  ]) {
    byId(id)?.addEventListener(
      'input',
      e => {
        e.target.dataset.userEdited = '1';
      }
    );
  }

  installAssetCardInteractions();
  installCalendar();
  installHistoryFilters();

  render();
  loadFeed();

} catch (e) {
  const status = byId('feedstatus');

  if (status) {
    status.textContent =
      '程式錯誤：'+e.message;
  }

  alert(
    'WEALTH 啟動失敗：'+e.message
  );
}

// END OF PART 3
// MARLOWE WEALTH
