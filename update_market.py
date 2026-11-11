
"""WEALTH V2.1 - delayed ETF quotes and verified fund NAVs.

Never invent prices, dates, or share classes.
Keep previous verified prices if a source is unavailable.
"""

import datetime
import json
import pathlib
import re
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).parent
OUT = ROOT / "market.json"

try:
    old = json.loads(OUT.read_text(encoding="utf-8"))
except Exception:
    old = {}

prices = old.get("prices", {})
if not isinstance(prices, dict):
    prices = {}

fx = old.get("fx")

HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "text/html,application/json",
}


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

    timezone_name = result.get("meta", {}).get(
        "exchangeTimezoneName", "UTC"
    )

    try:
        from zoneinfo import ZoneInfo
        zone = ZoneInfo(timezone_name)
    except Exception:
        zone = datetime.timezone.utc

    valid = [
        (timestamp, close)
        for timestamp, close in zip(timestamps, closes)
        if isinstance(close, (int, float)) and close > 0
    ]

    if not valid:
        raise ValueError("No valid closing price")

    timestamp, value = valid[-1]

    return {
        "value": round(float(value), 6),
        "date": datetime.datetime.fromtimestamp(
            timestamp, zone
        ).date().isoformat(),
        "source": "Yahoo Finance daily close (delayed)",
    }


def update_price(asset_id, item):
    if not isinstance(item, dict):
        return False

    value = item.get("value")
    date = item.get("date", "")

    if not isinstance(value, (int, float)) or value <= 0:
        return False

    try:
        parsed = datetime.date.fromisoformat(date)
        if parsed > datetime.datetime.now(
            datetime.timezone.utc
        ).date():
            return False
    except (ValueError, TypeError):
        return False

    previous = prices.get(asset_id, {})

    if date >= previous.get("date", ""):
        prices[asset_id] = item
        return True

    return False


# ETF prices
for asset_id, symbol in [
    ("009816", "009816.TW"),
    ("00646", "00646.TW"),
    ("VOO", "VOO"),
]:
    try:
        item = chart(symbol)
        update_price(asset_id, item)
        print("ETF", asset_id, item)
    except Exception as exc:
        print("ETF unavailable", asset_id, exc)

    time.sleep(1)


# USD/TWD
try:
    item = chart("TWD=X")
    if item["date"] >= (fx or {}).get("date", ""):
        fx = item
    print("USD/TWD", item)
except Exception as exc:
    print("FX unavailable", exc)


# Fund share classes confirmed from NEXT BANK holdings.
FUNDS = {
    "FUBON_SP500": {
        "code": "AFB0018",
        "name": "富邦標普500指數基金-A不配息(台幣)",
    },
    "FUBON_NASDAQ100": {
        "code": "AFB0022",
        "name": "富邦NASDAQ-100指數基金-A不配息(台幣)",
    },
    "YUANTA_NEW": {
        "code": "AYT0008",
        "name": "元大新主流基金A不配息(台幣)",
    },
    "YUANTA_DIV": {
        "code": "AYT0029",
        "name": "元大台灣高股息優質龍頭基金A不配息",
    },
}

# Public NAV listings; availability and page format
# must be validated by the first GitHub Actions run.
NAV_PAGES = [
    "https://fundv3new.moneydj.com/W2/ww/ww01.djhtm?a=BFZFPA&aspid=",
    "https://tsb.moneydj.com/w/ww/ww02.djhtm",
]


def normalize(text):
    return re.sub(r"[\s\-－–—（）()]", "", text).upper()


def parse_nav_date(text):
    match = re.search(
        r"(20\d{2})[/-](\d{1,2})[/-](\d{1,2})",
        text,
    )
    if not match:
        return None

    try:
        return datetime.date(
            int(match.group(1)),
            int(match.group(2)),
            int(match.group(3)),
        ).isoformat()
    except ValueError:
        return None


def fetch_fund_navs():
    from bs4 import BeautifulSoup

    found = {}

    for url in NAV_PAGES:
        try:
            html = download(url)
            soup = BeautifulSoup(html, "html.parser")
            rows = soup.select("tr")

            for row in rows:
                cells = [
                    cell.get_text(" ", strip=True)
                    for cell in row.find_all(
                        ["td", "th"], recursive=False
                    )
                ]

                if len(cells) < 3:
                    continue

                for asset_id, fund in FUNDS.items():
                    if asset_id in found:
                        continue

                    # Match the exact share-class name.
                    target = normalize(fund["name"])

                    name_cells = [
                        cell for cell in cells
                        if normalize(cell) == target
                        or normalize(cell).startswith(
                            target + "本基金"
                        )
                    ]

                    if len(name_cells) != 1:
                        continue

                    date = None
                    value = None

                    for cell in cells:
                        candidate = parse_nav_date(cell)
                        if candidate:
                            date = candidate
                            break

                    if not date:
                        continue

                    date_index = next(
                        (
                            i for i, cell in enumerate(cells)
                            if parse_nav_date(cell) == date
                        ),
                        None,
                    )

                    if date_index is None:
                        continue

                    # NAV must be the first numeric field
                    # after the full NAV date.
                    for cell in cells[date_index + 1:]:
                        cleaned = cell.replace(",", "").strip()
                        if re.fullmatch(
                            r"\d+(?:\.\d+)?", cleaned
                        ):
                            value = float(cleaned)
                            break

                    if not value or value <= 0:
                        continue

                    found[asset_id] = {
                        "value": value,
                        "date": date,
                        "source": "MoneyDJ published fund NAV",
                    }

            print("NAV page checked:", url)

        except Exception as exc:
            print("NAV source unavailable:", url, exc)

    return found


try:
    fund_prices = fetch_fund_navs()

    for asset_id, fund in FUNDS.items():
        item = fund_prices.get(asset_id)

        if item and update_price(asset_id, item):
            print(
                "FUND UPDATED",
                asset_id,
                fund["code"],
                item,
            )
        else:
            print(
                "FUND NOT VERIFIED",
                asset_id,
                fund["code"],
            )

except Exception as exc:
    print("Fund NAV update unavailable:", exc)


payload = {
    "updated_at": datetime.datetime.now(
        datetime.timezone.utc
    ).isoformat(timespec="seconds"),
    "fx": fx,
    "prices": prices,
    "notes": (
        "Delayed market closes and published fund NAVs. "
        "Unverified fund NAVs are not inserted."
    ),
}

OUT.write_text(
    json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)

print(
    "Finished. Available asset prices:",
    len(prices),
    "/ 7",
)
