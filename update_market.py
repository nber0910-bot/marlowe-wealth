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


def utc_now():
    return datetime.datetime.now(UTC)


def iso_utc(value):
    return value.isoformat(timespec="seconds")


def download(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20) as response:
        return response.read()


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
]

for asset_id, symbol in MARKET_SECURITIES:
    try:
        item = chart(symbol)
        update_price(asset_id, item)
        print("SECURITY", asset_id, item)
    except Exception as exc:
        print("SECURITY unavailable", asset_id, exc)
    time.sleep(1)


# USD/TWD
try:
    item = chart("TWD=X")
    if item["date"] >= (fx or {}).get("date", ""):
        fx = item
    print("USD/TWD", item)
except Exception as exc:
    print("FX unavailable", exc)


# BitoPro spot quotes. Each pair is validated independently; a failed request
# retains the last successfully recorded quote without inventing a live price.
def fetch_bitopro_crypto(pair):
    requested_at = utc_now()
    raw = json.loads(download("https://api.bitopro.com/v3/tickers/" + pair))
    data = raw.get("data")
    if isinstance(data, list):
        matches = [item for item in data if isinstance(item, dict) and str(item.get("pair", "")).lower() == pair]
        if len(matches) != 1:
            raise ValueError("Trading pair not uniquely found: " + pair)
        data = matches[0]
    if not isinstance(data, dict) or str(data.get("pair", "")).lower() != pair:
        raise ValueError("Unexpected BitoPro pair: " + pair)
    value = float(data["lastPrice"])
    if not math.isfinite(value) or value <= 0:
        raise ValueError("Invalid BitoPro lastPrice")
    return {
        "value": value, "date": requested_at.date().isoformat(),
        "source": "BitoPro " + pair.upper().replace("_", "/") + " last traded price",
        "retrieved_at": iso_utc(requested_at), "quote_type": "last_traded",
        "currency": "TWD", "pair": pair,
    }

for asset_id, pair in (("BTC", "btc_twd"), ("ETH", "eth_twd")):
    try:
        item = fetch_bitopro_crypto(pair)
        previous = prices.get(asset_id, {})
        if not isinstance(previous, dict):
            previous = {}
        if item["retrieved_at"] >= previous.get("retrieved_at", ""):
            prices[asset_id] = item
            print(asset_id, "UPDATED", item)
        else:
            print(asset_id, "older quote ignored")
    except Exception as exc:
        print(asset_id, "unavailable; previous quote retained:", exc)


# Confirmed NEXT BANK fund share classes
FUNDS = {
    "FUBON_SP500": {"code": "AFB0018", "name": "富邦標普500指數基金-A不配息(台幣)"},
    "FUBON_NASDAQ100": {"code": "AFB0022", "name": "富邦NASDAQ-100指數基金-A不配息(台幣)"},
    "YUANTA_NEW": {"code": "AYT0008", "name": "元大新主流基金A不配息(台幣)"},
    "YUANTA_DIV": {"code": "AYT0029", "name": "元大台灣高股息優質龍頭基金A不配息"},
}
NAV_PAGES = [
    "https://fundv3new.moneydj.com/W2/ww/ww01.djhtm?a=BFZFPA&aspid=",
    "https://fundv3new.moneydj.com/W2/ww/ww01.djhtm?a=BFZYTA&aspid=",
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


def fetch_fund_navs():
    from bs4 import BeautifulSoup
    found = {}
    for url in NAV_PAGES:
        try:
            soup = BeautifulSoup(download(url), "html.parser")
            for row in soup.select("tr"):
                cells = [
                    cell.get_text(" ", strip=True)
                    for cell in row.find_all(["td", "th"], recursive=False)
                ]
                if len(cells) < 3:
                    continue
                for asset_id, fund in FUNDS.items():
                    target = normalize(fund["name"])
                    name_cells = [cell for cell in cells if normalize(cell).startswith(target)]
                    if len(name_cells) != 1:
                        continue
                    date = None
                    date_index = None
                    for i, cell in enumerate(cells):
                        candidate = parse_nav_date(cell)
                        if candidate:
                            date, date_index = candidate, i
                            break
                    if not date:
                        continue
                    value = None
                    for cell in cells[date_index + 1:]:
                        cleaned = cell.replace(",", "").strip()
                        if re.fullmatch(r"\d+(?:\.\d+)?", cleaned):
                            value = float(cleaned)
                            break
                    if not value or value <= 0:
                        continue
                    item = {"value": value, "date": date, "source": "MoneyDJ published fund NAV"}
                    previous = found.get(asset_id)
                    if previous is None or item["date"] > previous["date"]:
                        found[asset_id] = item
            print("NAV page checked:", url)
        except Exception as exc:
            print("NAV source unavailable:", url, exc)
    return found

try:
    fund_prices = fetch_fund_navs()
    for asset_id, fund in FUNDS.items():
        item = fund_prices.get(asset_id)
        if item and update_price(asset_id, item):
            print("FUND UPDATED", asset_id, fund["code"], item)
        else:
            print("FUND NOT VERIFIED", asset_id, fund["code"])
except Exception as exc:
    print("Fund NAV update unavailable:", exc)


# Write market.json only. All unknown old keys are retained within prices.
payload = {
    "updated_at": iso_utc(utc_now()),
    "fx": fx,
    "prices": prices,
    "notes": (
        "Taiwan/US securities: Yahoo Finance delayed daily close; "
        "funds: MoneyDJ published NAV; BTC: BitoPro BTC/TWD last-traded snapshot. "
        "Each quote may have a different timestamp. "
        "Previous verified values are retained when sources are unavailable."
    ),
}
OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

expected_ids = [asset_id for asset_id, _ in MARKET_SECURITIES] + list(FUNDS) + ["BTC"]
available_assets = sum(
    1 for asset_id in expected_ids
    if isinstance(prices.get(asset_id), dict)
    and isinstance(prices[asset_id].get("value"), (int, float))
    and math.isfinite(prices[asset_id]["value"])
    and prices[asset_id]["value"] > 0
)
print("Finished. Available asset prices:", available_assets, "/", len(expected_ids))
