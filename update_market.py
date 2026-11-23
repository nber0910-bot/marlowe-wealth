"""MARLOWE WEALTH - Market Data Updater.

ETFs and US stocks: Yahoo Finance delayed daily close.
Funds: verified published NAV. BTC/ETH: BitoPro TWD ticker snapshots.
Keep previously verified quotes when a source is unavailable.
This script updates market.json only, never holdings or transactions.
"""

import datetime
import json
import math
import pathlib
import re
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).parent
OUT = ROOT / "market.json"
UTC = datetime.timezone.utc

try:
    old = json.loads(OUT.read_text(encoding="utf-8"))
except Exception:
    old = {}

prices = old.get("prices", {})
if not isinstance(prices, dict):
    prices = {}
fx = old.get("fx")
HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "text/html,application/json"}
errors = {}
successful = []


def utc_now():
    return datetime.datetime.now(UTC)


def iso_utc(value):
    return value.isoformat(timespec="seconds")


def download(url):
    req = urllib.request.Request(url, headers=HEADERS)
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            last = exc
            if attempt < 2:
                time.sleep(1 + attempt)
    raise last


def chart(symbol):
    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/"
        + urllib.parse.quote(symbol, safe="")
        + "?range=10d&interval=1d"
    )
    data = json.loads(download(url))
    result = data["chart"]["result"][0]
    timestamps = result["timestamp"]
    closes = result["indicators"]["quote"][0]["close"]
    timezone_name = result.get("meta", {}).get("exchangeTimezoneName", "UTC")
    try:
        from zoneinfo import ZoneInfo
        zone = ZoneInfo(timezone_name)
    except Exception:
        zone = UTC
    valid = [
        (timestamp, close)
        for timestamp, close in zip(timestamps, closes)
        if isinstance(close, (int, float)) and math.isfinite(close) and close > 0
    ]
    if not valid:
        raise ValueError("No valid closing price")
    timestamp, value = valid[-1]
    return {
        "value": round(float(value), 6),
        "date": datetime.datetime.fromtimestamp(timestamp, zone).date().isoformat(),
        "source": "Yahoo Finance daily close (delayed)",
    }


def update_price(asset_id, item):
    if not isinstance(item, dict):
        return False
    value = item.get("value")
    date = item.get("date", "")
    if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        return False
    try:
        parsed = datetime.date.fromisoformat(date)
        if parsed > utc_now().date():
            return False
    except (ValueError, TypeError):
        return False
    previous = prices.get(asset_id, {})
    if not isinstance(previous, dict):
        previous = {}
    if date >= previous.get("date", ""):
        prices[asset_id] = item
        return True
    return False


# Taiwan ETFs, US ETF, and US individual stock.
# The ID "NVDA" must match the holding ID used by app.js.
MARKET_SECURITIES = [
    ("009816", "009816.TW"),
    ("00646", "00646.TW"),
    ("00713", "00713.TW"),
    ("VOO", "VOO"),
    ("NVDA", "NVDA"),
    ("KO", "KO"),
]

for asset_id, symbol in MARKET_SECURITIES:
    try:
        item = chart(symbol)
        update_price(asset_id, item)
        successful.append(asset_id)
        print("SECURITY", asset_id, item)
    except Exception as exc:
        errors[asset_id] = str(exc)
        print("SECURITY unavailable", asset_id, exc)
    time.sleep(1)


# Major market indices for the top ticker. Stored separately from owned holdings.
# A failed lookup retains the last verified value, and never invents a quote.
indices = old.get("indices", {})
if not isinstance(indices, dict):
    indices = {}
INDEX_SYMBOLS = [
    ("TWII", "^TWII"),
    ("SP500", "^GSPC"),
    ("NASDAQ", "^IXIC"),
    ("SOX", "^SOX"),
    ("DJI", "^DJI"),
]
for index_id, symbol in INDEX_SYMBOLS:
    try:
        item = chart(symbol)
        # Daily close from Yahoo, plus previous completed candle for day-on-day change.
        url = ("https://query1.finance.yahoo.com/v8/finance/chart/"
               + urllib.parse.quote(symbol, safe="") + "?range=10d&interval=1d")
        result = json.loads(download(url))["chart"]["result"][0]
        closes = [float(x) for x in result["indicators"]["quote"][0]["close"]
                  if isinstance(x, (int, float)) and math.isfinite(x) and x > 0]
        if len(closes) >= 2:
            item["change_pct"] = round((closes[-1] / closes[-2] - 1) * 100, 4)
        previous = indices.get(index_id, {})
        if not isinstance(previous, dict) or item["date"] >= previous.get("date", ""):
            indices[index_id] = item
        print("INDEX", index_id, item)
    except Exception as exc:
        print("INDEX unavailable", index_id, exc)
    time.sleep(1)

# USD/TWD
try:
    item = chart("TWD=X")
    if item["date"] >= (fx or {}).get("date", ""):
        fx = item
    print("USD/TWD", item)
except Exception as exc:
    print("FX unavailable", exc)


# USD crypto quotes: independent exchange spot endpoints with Yahoo daily-close fallback.
# The app's existing crypto assets are TWD-denominated. Convert the verified USD
# quote to TWD before publishing, retaining the original USD price for audit.
def usd_crypto_quote(asset_id):
    symbol = {'BTC':'BTC-USD','ETH':'ETH-USD'}[asset_id]
    pair = {'BTC':'BTC-USD','ETH':'ETH-USD'}[asset_id]
    failures = []
    endpoints = [
        ('Coinbase Exchange USD spot', 'https://api.exchange.coinbase.com/products/'+pair+'/ticker'),
        ('Coinbase USD spot', 'https://api.coinbase.com/v2/prices/'+pair+'/spot'),
    ]
    for label,url in endpoints:
        try:
            now=utc_now()
            raw=json.loads(download(url))
            if 'Coinbase Exchange' in label:
                usd=float(raw['price'])
                timestamp=raw.get('time') or iso_utc(now)
            else:
                usd=float(raw['data']['amount'])
                if raw['data'].get('currency')!='USD' or raw['data'].get('base')!=asset_id:
                    raise ValueError('Currency or base mismatch')
                timestamp=iso_utc(now)
            if not math.isfinite(usd) or usd<=0:raise ValueError('Invalid USD spot price')
            return usd,label,timestamp
        except Exception as exc:failures.append(label+': '+str(exc))
    try:
        daily=chart(symbol)
        return daily['value'],'Yahoo Finance '+symbol+' daily close (delayed)',daily['date']+'T23:59:00+00:00'
    except Exception as exc:
        failures.append('Yahoo: '+str(exc))
    raise ValueError('; '.join(failures))

for asset_id in ('BTC','ETH'):
    try:
        usd,source,quote_time=usd_crypto_quote(asset_id)
        rate=float(fx['value']) if isinstance(fx,dict) else 0
        if not math.isfinite(rate) or rate<=0:raise ValueError('USD/TWD unavailable')
        now=utc_now()
        quote_dt=datetime.datetime.fromisoformat(quote_time.replace('Z','+00:00'))
        if quote_dt.tzinfo is None:quote_dt=quote_dt.replace(tzinfo=UTC)
        if quote_dt>now+datetime.timedelta(minutes=5):raise ValueError('Future crypto timestamp')
        if now-quote_dt>datetime.timedelta(days=4):raise ValueError('Crypto USD quote is too old')
        fxdate=datetime.date.fromisoformat(fx['date'])
        if now.date()-fxdate>datetime.timedelta(days=5):raise ValueError('USD/TWD FX quote is too old')
        item={'value':round(usd*rate,6),'date':quote_dt.date().isoformat(),
              'source':source+' · USD/TWD converted',
              'retrieved_at':iso_utc(now),'quote_time':quote_dt.isoformat(),
              'quote_type':'usd_spot_converted' if 'spot' in source.lower() else 'usd_daily_close_converted',
              'currency':'TWD','pair':asset_id.lower()+'_twd',
              'usd_price':usd,'usd_twd':rate,'fx_date':fx['date'],'usd_source':source}
        previous=prices.get(asset_id,{})
        if not isinstance(previous,dict) or item['retrieved_at']>=previous.get('retrieved_at',''):
            prices[asset_id]=item
            successful.append(asset_id)
            print('CRYPTO UPDATED',asset_id,item)
    except Exception as exc:
        errors[asset_id]=str(exc)
        print('CRYPTO unavailable, previous retained:',asset_id,exc)

# Confirmed NEXT BANK fund share classes
FUNDS = {
    "FUBON_SP500": {"code": "AFB0018", "name": "富邦標普500指數基金-A不配息(台幣)"},
    "FUBON_NASDAQ100": {"code": "AFB0022", "name": "富邦NASDAQ-100指數基金-A不配息(台幣)"},
    "YUANTA_NEW": {"code": "AYT0008", "name": "元大新主流基金A不配息(台幣)"},
    "YUANTA_DIV": {"code": "AYT0029", "name": "元大台灣高股息優質龍頭基金A不配息"},
}
# Exact A-class TWD fund IDs verified against Fubon Asset Management.
# The source is the fund manager's dated NAV table, not a similar share class.
FUBON_OFFICIAL = {
    'FUBON_SP500':('106A','富邦標普500指數基金-A類型（新臺幣）'),
    'FUBON_NASDAQ100':('107A','富邦NASDAQ-100指數基金-A類型（新臺幣）'),
}
NAV_PAGES = [
    'https://tbbfws.moneydj.com/W4/ww/ww01.djhtm?a=BFZFPA&aspid=ESUN',
    'https://fundv3new.moneydj.com/W2/ww/ww01.djhtm?a=BFZFPA&aspid=',
    'https://fundv3new.moneydj.com/W2/ww/ww01.djhtm?a=BFZYTA&aspid=',
]


def normalize(value):
    return re.sub(r"[\s\-－–—（）()]", "", value).upper()


def parse_nav_date(value):
    match = re.search(r"(20\d{2})[/-](\d{1,2})[/-](\d{1,2})", value)
    if not match:
        return None
    try:
        return datetime.date(int(match.group(1)), int(match.group(2)), int(match.group(3))).isoformat()
    except ValueError:
        return None


def fetch_official_fubon_nav(asset_id):
    from bs4 import BeautifulSoup
    code,exact_name=FUBON_OFFICIAL[asset_id]
    url='https://www.fubon.com/asset-management/fund/info/value?Fd='+code
    soup=BeautifulSoup(download(url),'html.parser')
    text=soup.get_text(' ',strip=True)
    if normalize(exact_name) not in normalize(text):
        raise ValueError('Official page fund/share class mismatch: '+asset_id)
    # Parse dated rows. A row must contain exactly one date and a numeric NAV
    # immediately after the date. Avoid NAV composition and other numeric fields.
    observations=[]
    for tr in soup.select('tr'):
        cells=[c.get_text(' ',strip=True) for c in tr.find_all(['td','th'],recursive=False)]
        for i,cell in enumerate(cells[:-1]):
            d=parse_nav_date(cell)
            if not d or len(cell.strip())>20:continue
            for candidate in cells[i+1:i+3]:
                m=re.fullmatch(r'\s*(\d{1,3}(?:\.\d{1,6})?)\s*',candidate)
                if m:
                    v=float(m.group(1))
                    if 1<=v<=100:observations.append((d,v))
                    break
    # Some Fubon pages use date/value div layouts rather than <tr>.
    if not observations:
        pattern=r'(20\d{2}/\d{1,2}/\d{1,2})\s+(\d{1,3}\.\d{1,6})(?!\d)'
        for d,v in re.findall(pattern,text):
            date=parse_nav_date(d);value=float(v)
            if date and 1<=value<=100:observations.append((date,value))
    if not observations:raise ValueError('No verifiable dated NAV rows on official page')
    date,value=max(observations)
    if date>utc_now().date().isoformat():raise ValueError('Future NAV date')
    return {'value':value,'date':date,'source':'富邦投信官方基金淨值 · '+code}


def fetch_fund_navs():
    from bs4 import BeautifulSoup
    found={}
    # Fund manager first; no cross-share-class or cross-currency substitution.
    for asset_id in FUBON_OFFICIAL:
        try:
            found[asset_id]=fetch_official_fubon_nav(asset_id)
            print('OFFICIAL FUBON NAV',asset_id,found[asset_id])
        except Exception as exc:print('OFFICIAL FUBON NAV unavailable',asset_id,exc)
    for url in NAV_PAGES:
        try:
            soup=BeautifulSoup(download(url),'html.parser')
            for row in soup.select('tr'):
                cells=[cell.get_text(' ',strip=True) for cell in row.find_all(['td','th'],recursive=False)]
                if len(cells)<3:continue
                for asset_id,fund in FUNDS.items():
                    target=normalize(fund['name'])
                    if len([cell for cell in cells if normalize(cell).startswith(target)])!=1:continue
                    for i,cell in enumerate(cells):
                        date=parse_nav_date(cell)
                        if not date:continue
                        for value_cell in cells[i+1:]:
                            cleaned=value_cell.replace(',','').strip()
                            if re.fullmatch(r'\d+(?:\.\d+)?',cleaned):
                                value=float(cleaned)
                                if value>0 and date<=utc_now().date().isoformat():
                                    item={'value':value,'date':date,'source':'MoneyDJ published fund NAV'}
                                    previous=found.get(asset_id)
                                    if previous is None or item['date']>previous['date']:
                                        found[asset_id]=item
                                break
                        break
            print('NAV page checked:',url)
        except Exception as exc:print('NAV source unavailable:',url,exc)
    return found

try:
    fund_prices = fetch_fund_navs()
    for asset_id, fund in FUNDS.items():
        item = fund_prices.get(asset_id)
        if item and update_price(asset_id, item):
            successful.append(asset_id)
            print("FUND UPDATED", asset_id, fund["code"], item)
        else:
            errors[asset_id] = "NAV not verified from available published source"
            print("FUND NOT VERIFIED", asset_id, fund["code"])
except Exception as exc:
    for asset_id in FUNDS: errors[asset_id] = str(exc)
    print("Fund NAV update unavailable:", exc)


# Write market.json only. All unknown old keys are retained within prices.
payload = {
    "updated_at": iso_utc(utc_now()),
    "fx": fx,
    "prices": prices,
    "indices": indices,
    "update_status": {
        "successful_ids": sorted(set(successful)),
        "failed_ids": sorted(errors),
        "errors": errors,
        "note": "An updated_at timestamp only confirms the file was refreshed, not every quote."
    },
    "notes": (
        "Taiwan/US securities: Yahoo Finance delayed daily close; "
        "funds: official Fubon NAV or MoneyDJ published NAV; BTC/ETH: USD quotes converted using USD/TWD. "
        "Each quote may have a different timestamp. "
        "Previous verified values are retained when sources are unavailable."
    ),
}
OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

expected_ids = [asset_id for asset_id, _ in MARKET_SECURITIES] + list(FUNDS) + ["BTC", "ETH"]
available_assets = sum(
    1 for asset_id in expected_ids
    if isinstance(prices.get(asset_id), dict)
    and isinstance(prices[asset_id].get("value"), (int, float))
    and math.isfinite(prices[asset_id]["value"])
    and prices[asset_id]["value"] > 0
)
print("Finished. Available asset prices:", available_assets, "/", len(expected_ids))
