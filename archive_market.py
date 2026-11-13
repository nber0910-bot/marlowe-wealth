#!/usr/bin/env python3
"""Append immutable, dated market observations without touching holdings."""
import json, datetime, pathlib, sys
root=pathlib.Path(__file__).resolve().parent
source=root/'market.json'; target=root/'daily-history.json'
if not source.exists():
    sys.exit('market.json missing; no changes')
market=json.loads(source.read_text(encoding='utf-8'))
if not isinstance(market.get('prices'),dict) or not market.get('updated_at'):
    sys.exit('market.json invalid; no changes')
now=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8)))
day=now.date().isoformat()
existing=json.loads(target.read_text(encoding='utf-8')) if target.exists() else {'schema':'marlowe-market-observations-v1','observations':[]}
observations=existing.get('observations',[])
if not isinstance(observations,list):sys.exit('Invalid archive')
record={'date':day,'captured_at':now.isoformat(),'market_updated_at':market['updated_at'],'fx':market.get('fx'), 'prices':market['prices'],'kind':'latest_available_observation','note':'Mixed quote dates; NOT verified synchronized closing P&L.'}
# Idempotent: retain one latest capture per Taiwan day. Never remove earlier days.
observations=[r for r in observations if r.get('date')!=day]
observations.append(record)
observations.sort(key=lambda r:r['date'])
existing['observations']=observations
existing['schema']='marlowe-market-observations-v1'
target.write_text(json.dumps(existing,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'Archived {day}: {len(market["prices"])} prices; {len(observations)} days')
