
"""MONO WEALTH — MARKET RISK DATA UPDATER.

Updates verified risk indicators in risk.json.
Never reads or modifies portfolio data, transactions, or localStorage.
"""

import csv
import datetime as dt
import io
import json
import math
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "risk.json"

TW_TZ = dt.timezone(dt.timedelta(hours=8))

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; MonoWealthRisk/2.0)",
    "Accept": "application/json,text/csv,text/plain,*/*",
}

METRIC_KEYS = (
    "vix",
    "dxy",
    "us10y",
    "hyspread",
    "margin",
    "foreign",
)


def now_tw():
    return dt.datetime.now(TW_TZ)


def today_iso():
    return now_tw().date().isoformat()


def get(url, timeout=10, attempts=3):
    """HTTP GET with bounded retries."""
    last_error = None

    for attempt in range(attempts):
        try:
            request = urllib.request.Request(
                url,
                headers=HEADERS,
            )

            with urllib.request.urlopen(
                request,
                timeout=timeout,
            ) as response:
                return response.read()

        except Exception as exc:
            last_error = exc

            if attempt < attempts - 1:
                time.sleep(min(1.0 * (attempt + 1), 3.0))

    raise last_error


def valid_number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def load_existing():
    try:
        data = json.loads(OUT.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def valid_old_metric(item):
    """Only preserve observations with a value and a valid date."""
    if not isinstance(item, dict):
        return False

    value = valid_number(item.get("value"))
    date = item.get("date")

    if value is None or not isinstance(date, str):
        return False

    try:
        observation_date = dt.date.fromisoformat(date)
    except ValueError:
        return False

    return observation_date <= now_tw().date()


def record(rows, source, unit):
    date, value = rows[-1]

    return {
        "value": round(float(value), 3),
        "date": date,
        "source": source,
        "unit": unit,
    }


def parse_fred_csv(raw, series):
    text = raw.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))

    observations = []
    today = today_iso()

    for row in reader:
        date = (
            row.get("observation_date")
            or row.get("DATE")
        )

        value = valid_number(row.get(series))

        if not date or value is None:
            continue

        if date > today:
            continue

        observations.append((date, value))

    observations.sort(key=lambda x: x[0])

    if not observations:
        raise ValueError(
            f"No valid FRED observations for {series}"
        )

    return observations[-6:]


def fred(series):
    """Download verified FRED observations.

    Both URLs refer to the same FRED series.
    No substitute indicator is used.
    """
    start = (
        now_tw().date() - dt.timedelta(days=60)
    ).isoformat()

    urls = [
        (
            "https://fred.stlouisfed.org/graph/fredgraph.csv"
            f"?id={urllib.parse.quote(series)}"
            f"&cosd={start}"
        ),
        (
            "https://fred.stlouisfed.org/graph/fredgraph.csv"
            f"?id={urllib.parse.quote(series)}"
        ),
        (
            "https://fred.stlouisfed.org/graph/fredgraph.csv"
            f"?id={urllib.parse.quote(series)}"
            f"&cosd={start}&cosd1={start}"
        ),
    ]

    errors = []

    for url in urls:
        try:
            raw = get(
                url,
                timeout=12,
                attempts=2,
            )

            return parse_fred_csv(raw, series)

        except Exception as exc:
            errors.append(str(exc))

    raise RuntimeError(
        f"FRED {series} unavailable: "
        + " | ".join(errors)
    )


def yahoo_series(symbol):
    encoded = urllib.parse.quote(
        symbol,
        safe="",
    )

    urls = [
        (
            "https://query1.finance.yahoo.com/v8/finance/chart/"
            f"{encoded}?range=1mo&interval=1d"
        ),
        (
            "https://query2.finance.yahoo.com/v8/finance/chart/"
            f"{encoded}?range=1mo&interval=1d"
        ),
    ]

    errors = []

    for url in urls:
        try:
            payload = json.loads(
                get(url, timeout=10, attempts=2)
            )

            result = payload["chart"]["result"][0]

            timestamps = result.get("timestamp") or []

            quote = result["indicators"]["quote"][0]
            closes = quote.get("close") or []

            observations = []

            for timestamp, close in zip(
                timestamps,
                closes,
            ):
                value = valid_number(close)

                if value is None:
                    continue

                date = dt.datetime.fromtimestamp(
                    timestamp,
                    dt.timezone.utc,
                ).date().isoformat()

                if date <= today_iso():
                    observations.append((date, value))

            observations.sort(key=lambda x: x[0])

            if observations:
                return observations[-6:]

            raise ValueError(
                f"No valid Yahoo observations: {symbol}"
            )

        except Exception as exc:
            errors.append(str(exc))

    raise RuntimeError(
        f"Yahoo {symbol} unavailable: "
        + " | ".join(errors)
    )


def fetch_fred_with_fallback(
    series,
    source,
    unit,
    fallback_symbol=None,
    fallback_source=None,
):
    try:
        rows = fred(series)
        return rows, source

    except Exception as primary_error:
        if not fallback_symbol:
            raise RuntimeError(
                f"Primary source failed: {primary_error}"
            )

        try:
            rows = yahoo_series(fallback_symbol)

            return rows, fallback_source

        except Exception as fallback_error:
            raise RuntimeError(
                f"FRED: {primary_error}; "
                f"Yahoo: {fallback_error}"
            )


def update_vix():
    rows, source = fetch_fred_with_fallback(
        series="VIXCLS",
        source="FRED · CBOE VIX",
        unit="index",
        fallback_symbol="^VIX",
        fallback_source=(
            "Yahoo Finance · CBOE VIX (delayed)"
        ),
    )

    return record(rows, source, "index")


def update_dxy():
    rows = yahoo_series("DX-Y.NYB")

    obj = record(
        rows,
        "Yahoo Finance · DX-Y.NYB (delayed)",
        "index",
    )

    if len(rows) >= 6 and rows[-6][1] != 0:
        obj["change_5d_pct"] = round(
            (
                rows[-1][1] / rows[-6][1] - 1
            ) * 100,
            3,
        )

    return obj


def update_us10y():
    rows, source = fetch_fred_with_fallback(
        series="DGS10",
        source="FRED · US Treasury 10Y",
        unit="%",
        fallback_symbol="^TNX",
        fallback_source=(
            "Yahoo Finance · CBOE 10Y yield index (delayed)"
        ),
    )

    obj = record(rows, source, "%")

    if len(rows) >= 6:
        obj["change_5d"] = round(
            rows[-1][1] - rows[-6][1],
            3,
        )

    return obj


def update_hyspread():
    """ICE BofA US High Yield Option-Adjusted Spread.

    FRED series BAMLH0A0HYM2, percentage points.
    Never replace with an unrelated credit indicator.
    """
    rows = fred("BAMLH0A0HYM2")

    return record(
        rows,
        "FRED · ICE BofA US HY OAS",
        "percentage points",
    )


def parse_amount(value):
    if value is None:
        return None

    text = str(value).strip()

    text = (
        text.replace(",", "")
        .replace("+", "")
        .replace("−", "-")
        .replace("－", "-")
    )

    return valid_number(text)


def normalize_text(value):
    return (
        str(value or "")
        .replace(" ", "")
        .replace("　", "")
        .replace("（", "(")
        .replace("）", ")")
    )


def find_foreign_row(rows):
    """Find foreign investors, excluding foreign proprietary dealers.

    '外資及陸資(不含外資自營商)' is a valid foreign-investor row.
    Do not reject it just because its name contains '自營商'.
    """
    for row in rows:
        if not isinstance(row, list) or not row:
            continue

        name = normalize_text(row[0])

        if (
            "外資及陸資" in name
            and not name.startswith("外資自營商")
        ):
            return row

    return None


def find_net_column(fields):
    """Locate the official net buy/sell amount column."""
    if not isinstance(fields, list):
        return None

    for index, field in enumerate(fields):
        name = normalize_text(field)

        if (
            "買賣差額" in name
            or "買賣超" in name
        ):
            return index

    return None


def parse_twse_foreign(payload, requested_date):
    """Parse an official TWSE BFI82U response."""
    if not isinstance(payload, dict):
        raise ValueError("Invalid TWSE response")

    rows = payload.get("data") or []
    fields = payload.get("fields") or []

    if not rows:
        return None

    foreign = find_foreign_row(rows)

    if foreign is None:
        raise ValueError(
            "TWSE foreign-investor row not found"
        )

    net_index = find_net_column(fields)

    if net_index is None:
        raise ValueError(
            "TWSE net-flow column not found"
        )

    if net_index >= len(foreign):
        raise ValueError(
            "TWSE net-flow column is out of range"
        )

    amount = parse_amount(foreign[net_index])

    if amount is None:
        raise ValueError(
            "TWSE foreign net-flow is not numeric"
        )

    # BFI82U reports amounts in TWD.
    # Convert to NT$100 million (億元).
    value = amount / 100_000_000

    # Prefer the verified date in the official response.
    raw_date = str(payload.get("date") or "").strip()

    date = requested_date.isoformat()

    if len(raw_date) == 8 and raw_date.isdigit():
        try:
            date = dt.datetime.strptime(
                raw_date,
                "%Y%m%d",
            ).date().isoformat()
        except ValueError:
            pass

    return date, value


def twse_foreign():
    """Official TWSE BFI82U foreign-investor net flow.

    Use the latest available trading observations.
    Do not infer net flow from trading volume.
    """
    today = now_tw().date()

    candidate_days = [
        today - dt.timedelta(days=i)
        for i in range(16)
    ]

    candidate_days = [
        day
        for day in candidate_days
        if day.weekday() < 5
    ][:7]

    observations = []
    failures = []

    for day in candidate_days:
        url = (
            "https://www.twse.com.tw/rwd/zh/fund/BFI82U"
            f"?type=day&dayDate={day:%Y%m%d}"
            "&response=json"
        )

        try:
            payload = json.loads(
                get(
                    url,
                    timeout=6,
                    attempts=1,
                )
            )

            result = parse_twse_foreign(
                payload,
                day,
            )

            if result is None:
                continue

            if result not in observations:
                observations.append(result)

            if len(observations) >= 5:
                break

        except Exception as exc:
            failures.append(
                f"{day.isoformat()}: {exc}"
            )

    if not observations:
        detail = (
            "; ".join(failures[:3])
            if failures
            else "No published observations"
        )

        raise RuntimeError(
            f"TWSE institutional flow unavailable: {detail}"
        )

    observations.sort(
        key=lambda x: x[0],
        reverse=True,
    )

    date, value = observations[0]

    obj = {
        "value": round(value, 2),
        "date": date,
        "source": (
            "TWSE · 三大法人買賣金額統計表"
        ),
        "unit": "億元",
    }

    if len(observations) >= 5:
        obj["sum_5d"] = round(
            sum(
                value
                for _, value in observations[:5]
            ),
            2,
        )

    return obj


def pending_margin():
    """Do not substitute a different margin-maintenance metric."""
    return {
        "value": None,
        "date": None,
        "source": (
            "同口徑官方資料待串接"
            "（不以其他融資指標替代）"
        ),
        "unit": "%",
    }


def main():
    old = load_existing()

    old_metrics = old.get("metrics", {})

    if not isinstance(old_metrics, dict):
        old_metrics = {}

    metrics = {}
    errors = {}

    jobs = {
        "vix": update_vix,
        "dxy": update_dxy,
        "us10y": update_us10y,
        "hyspread": update_hyspread,
        "foreign": twse_foreign,
    }

    for key, job in jobs.items():
        print(f"[MONO RISK] Updating {key}...")

        try:
            result = job()

            if not valid_old_metric(result):
                raise ValueError(
                    "Source returned invalid observation"
                )

            metrics[key] = result

            print(
                f"[OK] {key}: "
                f"{result['value']} "
                f"({result['date']})"
            )

        except Exception as exc:
            errors[key] = str(exc)

            previous = old_metrics.get(key)

            if valid_old_metric(previous):
                metrics[key] = dict(previous)

                print(
                    f"[STALE] {key}: "
                    f"keeping previous verified value"
                )

            else:
                metrics[key] = {
                    "value": None,
                    "date": None,
                    "source": "資料來源暫時無法取得",
                }

                print(
                    f"[MISSING] {key}: {exc}"
                )

    # Explicitly pending until a verified same-definition
    # official margin-maintenance source is implemented.
    metrics["margin"] = pending_margin()

    # Preserve the original six-indicator JSON structure.
    ordered_metrics = {
        key: metrics[key]
        for key in METRIC_KEYS
    }

    output = {
        "updated_at": dt.datetime.now(
            dt.timezone.utc
        ).isoformat(timespec="seconds"),
        "metrics": ordered_metrics,
        "errors": errors,
    }

    # Write atomically to avoid truncated risk.json files.
    temp_path = OUT.with_suffix(".json.tmp")

    temp_path.write_text(
        json.dumps(
            output,
            ensure_ascii=False,
            indent=2,
            allow_nan=False,
        ) + "\n",
        encoding="utf-8",
    )

    temp_path.replace(OUT)

    successful = [
        key
        for key in jobs
        if key not in errors
    ]

    print()
    print("MONO MARKET RISK update completed.")
    print("Successful:", ", ".join(successful) or "none")
    print("Errors:", json.dumps(errors, ensure_ascii=False))
    print("Output:", OUT)


if __name__ == "__main__":
    main()
