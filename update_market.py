"""Best-effort delayed quotes. Never invent values or dates."""
import json,datetime,urllib.request,urllib.parse,time,pathlib
ROOT=pathlib.Path(__file__).parent
OUT=ROOT/'market.json'
try: old=json.loads(OUT.read_text())
except Exception: old={}
prices=old.get('prices',{})
fx=old.get('fx')

def chart(symbol):
    url='https://query1.finance.yahoo.com/v8/finance/chart/'+urllib.parse.quote(symbol,safe='')+'?range=10d&interval=1d'
    req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 (compatible; PortfolioQuoteBot/1.0)','Accept':'application/json'})
    with urllib.request.urlopen(req,timeout=18) as r: data=json.load(r)
    result=data['chart']['result'][0]
    times=result['timestamp'];closes=result['indicators']['quote'][0]['close']
    tz=result.get('meta',{}).get('exchangeTimezoneName','UTC')
    try:
        from zoneinfo import ZoneInfo
        zone=ZoneInfo(tz)
    except Exception: zone=datetime.timezone.utc
    valid=[(t,p) for t,p in zip(times,closes) if isinstance(p,(int,float)) and p>0]
    if not valid:raise ValueError('no valid closing price')
    t,p=valid[-1]
    return {'value':round(float(p),6),'date':datetime.datetime.fromtimestamp(t,zone).date().isoformat(),'source':'Yahoo Finance daily close (delayed)'}

for id,symbol in [('009816','009816.TW'),('00646','00646.TW'),('VOO','VOO')]:
    try:
        new=chart(symbol)
        if new['date']>=prices.get(id,{}).get('date',''):prices[id]=new
        print(id,new)
    except Exception as e:print('unavailable',id,str(e))
    time.sleep(1)
try:
    rate=chart('TWD=X')
    if rate['date']>=(fx or {}).get('date',''):fx=rate
    print('USD/TWD',rate)
except Exception as e:print('FX unavailable',e)
# Funds require exact share-class identifiers and a licensed/verified NAV source.
# Intentionally leave them missing rather than map an incorrect fund.
OUT.write_text(json.dumps({'updated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),'fx':fx,'prices':prices,'notes':'Daily delayed closes, not intraday. Fund NAV sources pending verified identifiers.'},ensure_ascii=False,indent=2)+'\n')
