"""Refresh verified market risk metrics. No portfolio data is read or modified."""
import csv, datetime as dt, io, json, math, pathlib, urllib.request
ROOT=pathlib.Path(__file__).parent
OUT=ROOT/"risk.json"
HEAD={"User-Agent":"Mozilla/5.0 (compatible; MonoWealthRisk/1.0)"}
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url,headers=HEAD),timeout=18) as r:return r.read()
def fred(series):
    url=f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}"
    rows=list(csv.DictReader(io.StringIO(get(url).decode("utf-8-sig"))))
    vals=[]
    for r in rows:
        try:
            date=r.get("observation_date") or r.get("DATE")
            v=float(r[series])
            if math.isfinite(v) and date and date<=dt.date.today().isoformat():vals.append((date,v))
        except (ValueError,TypeError,KeyError):pass
    if not vals:raise ValueError(f"No valid {series} observations")
    return vals[-6:]
def yahoo_dxy():
    url="https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?range=1mo&interval=1d"
    data=json.loads(get(url))["chart"]["result"][0]
    out=[]
    for t,v in zip(data["timestamp"],data["indicators"]["quote"][0]["close"]):
        if isinstance(v,(int,float)) and math.isfinite(v):
            out.append((dt.datetime.fromtimestamp(t,dt.timezone.utc).date().isoformat(),float(v)))
    if not out:raise ValueError("DXY unavailable")
    return out[-6:]
def record(rows,source,unit):
    d,v=rows[-1]
    return {"value":round(v,3),"date":d,"source":source,"unit":unit}

def twse_foreign():
    """Latest TWSE institutional flow; units are TWD, output in 100m TWD."""
    today=dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date()
    observations=[]
    for delta in range(12,-1,-1):
        day=today-dt.timedelta(days=delta)
        if day.weekday()>=5:continue
        url=f"https://www.twse.com.tw/rwd/zh/fund/BFI82U?type=day&dayDate={day:%Y%m%d}&response=json"
        try:
            payload=json.loads(get(url))
            rows=payload.get("data") or []
            foreign=next((r for r in rows if r and "外資及陸資" in str(r[0]) and "自營商" not in str(r[0])),None)
            if not foreign or len(foreign)<4:continue
            amount=float(str(foreign[3]).replace(",","").replace("+",""))
            observations.append((day.isoformat(),amount/100000000))
        except (ValueError,TypeError,KeyError,IndexError,StopIteration,OSError):continue
    if not observations:raise ValueError("TWSE institutional flow unavailable")
    date,value=observations[-1]
    obj={"value":round(value,2),"date":date,"source":"TWSE · 三大法人買賣金額統計表","unit":"億元"}
    if len(observations)>=5:obj["sum_5d"]=round(sum(v for _,v in observations[-5:]),2)
    return obj

def main():
    try: old=json.loads(OUT.read_text())
    except (OSError,ValueError):old={}
    metrics=old.get("metrics",{})
    if not isinstance(metrics,dict):metrics={}
    jobs={"vix":("VIXCLS","FRED · CBOE VIX","index"),"us10y":("DGS10","FRED · US Treasury 10Y","%"),"hyspread":("BAMLH0A0HYM2","FRED · ICE BofA HY OAS","percentage points")}
    errors={}
    for key,(series,source,unit) in jobs.items():
        try:
            rows=fred(series); obj=record(rows,source,unit)
            if key=="us10y" and len(rows)>=6:obj["change_5d"]=round(rows[-1][1]-rows[-6][1],3)
            metrics[key]=obj
        except Exception as e:errors[key]=str(e)
    try:
        rows=yahoo_dxy();obj=record(rows,"Yahoo Finance · DX-Y.NYB (delayed)","index")
        if len(rows)>=6 and rows[-6][1]:obj["change_5d_pct"]=round((rows[-1][1]/rows[-6][1]-1)*100,3)
        metrics["dxy"]=obj
    except Exception as e:errors["dxy"]=str(e)
    try:
        metrics["foreign"]=twse_foreign()
    except Exception as e:
        errors["foreign"]=str(e)
    # 不限用途擔保維持率與融資擔保維持率不同，禁止混用。
    metrics.setdefault("margin",{"value":None,"date":None,"source":"同口徑官方資料待串接"})
    OUT.write_text(json.dumps({"updated_at":dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),"metrics":metrics,"errors":errors},ensure_ascii=False,indent=2)+"\\n")
    print("Risk metrics updated:",", ".join(k for k in jobs if k not in errors), "DXY" if "dxy" not in errors else "", "errors:",errors)
if __name__=="__main__":main()
