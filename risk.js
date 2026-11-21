(function(){
  'use strict';
  const fields=[['vix','VIX','恐慌指數',''],['dxy','DXY','美元指數',''],['us10y','US10Y','美債10年殖利率','%'],['hyspread','HY SPREAD','高收益債利差','%'],['margin','MARGIN','融資維持率','%'],['foreign','FOREIGN','外資買賣超','億元']];
  const el=id=>document.getElementById(id);
  const esc=x=>String(x??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // 燈號只在有足夠且未過期的資料時顯示；未知不當成綠燈。
  function signal(k,d){
    const v=d?.value;
    if(!Number.isFinite(v)||!d?.date)return ['gray','資料不足'];
    const age=(Date.now()-Date.parse(d.date+'T23:59:59Z'))/86400000;
    if(!Number.isFinite(age)||age>5||age< -1)return ['gray','資料過期'];
    if(k==='vix')return v>=30?['red','高風險']:v>=20?['yellow','警戒']:['green','相對平穩'];
    if(k==='hyspread')return v>=5?['red','高風險']:v>=4?['yellow','警戒']:['green','相對平穩'];
    if(k==='dxy'){
      const c=d.change_5d_pct;
      if(!Number.isFinite(c))return ['gray','缺少5日變化'];
      return c>=2?['red','美元急升']:c>=1?['yellow','美元走強']:['green','未見急升'];
    }
    if(k==='us10y'){
      const c=d.change_5d;
      if(!Number.isFinite(c))return ['gray','缺少5日變化'];
      return c>=0.3?['red','利率急升']:c>=0.15?['yellow','利率上行']:['green','未見急升'];
    }
    if(k==='foreign'){
      const c=d.sum_5d;
      if(!Number.isFinite(c))return ['gray','缺少5日累計'];
      return c<=-500?['red','持續賣超']:c<0?['yellow','偏向賣超']:['green','未見淨賣超'];
    }
    // 融資維持率各券商口徑不同，未定義可靠門檻前不強行分級。
    return ['gray','門檻待校準'];
  }
  function tiles(m){
    const grid=el('riskGrid'); if(!grid)return;
    grid.innerHTML=fields.map(([k,n,label,u])=>{
      const d=m[k]||{}, value=typeof d.value==='number'&&Number.isFinite(d.value)?d.value:null;
      const [color,status]=signal(k,d);
      const details=Number.isFinite(d.sum_5d)?'<br>近5日累計 '+esc(d.sum_5d)+' 億元':'';
      return `<div class="risk-tile"><small>${label}</small><div class="risk-reading"><strong>${value===null?'—':value.toLocaleString('zh-TW')+u}</strong><span class="risk-light risk-light-${color}" role="img" aria-label="風險燈號：${esc(status)}" title="${esc(status)}"></span></div><div class="risk-tile-status risk-status-${color}">${esc(status)}</div><small>${n} · ${esc(d.date||'待更新')}<br>${esc(d.source||'資料待串接')}${details}</small></div>`;
    }).join('');
  }
  function readJson(raw){
    try{return JSON.parse(raw)}catch(first){
      // Prior updater accidentally wrote literal backslash-n after the closing brace.
      const cleaned=raw.replace(/(?:\\n)+\s*$/,'').trim();
      if(cleaned!==raw.trim())return JSON.parse(cleaned);
      throw first;
    }
  }
  window.loadMarketRisk=async function(){
    tiles({});
    if(el('riskStatus'))el('riskStatus').textContent='⚪ 資料檢查中';
    try{
      const response=await fetch('./risk.json?t='+Date.now(),{cache:'no-store'});
      if(!response.ok)throw Error('資料檔無法讀取（HTTP '+response.status+'）');
      const j=readJson(await response.text()),m=j.metrics||{};
      tiles(m);
      const core=['vix','dxy','us10y','hyspread'];
      const missing=core.filter(k=>!Number.isFinite(m[k]?.value)||!m[k]?.date);
      const stale=core.filter(k=>{
        const d=m[k];if(!Number.isFinite(d?.value)||!d.date)return false;
        const ts=Date.parse(d.date+'T23:59:59Z');
        const age=(Date.now()-ts)/86400000;
        return !Number.isFinite(age)||age>5||age< -1;
      });
      if(missing.length||stale.length){
        el('riskStatus').textContent='⚪ 資料不足';
        const issues=[];
        if(missing.length)issues.push('缺少：'+missing.join('、'));
        if(stale.length)issues.push('過期：'+stale.join('、'));
        const errors=Object.entries(j.errors||{}).map(([k,v])=>k+'：'+String(v).slice(0,80));
        el('riskSummary').textContent=issues.join('；')+'。尚不能可靠判定整體風險。'+(errors.length?' 更新診斷：'+errors.join('；'):'');
        return;
      }
      const score=(m.vix.value>=30?2:m.vix.value>=20?1:0)+(m.hyspread.value>=5?2:m.hyspread.value>=4?1:0)+(Number.isFinite(m.dxy.change_5d_pct)&&m.dxy.change_5d_pct>=2?1:0)+(Number.isFinite(m.us10y.change_5d)&&m.us10y.change_5d>=0.3?1:0);
      el('riskStatus').textContent=score>=4?'🔴 高風險':score>=2?'🟡 警戒':'🟢 相對平穩';
      el('riskSummary').textContent='依波動、信用利差、美元與利率變化簡化評估；台灣資料缺漏時不納入評分。';
    }catch(error){
      tiles({});
      el('riskStatus').textContent='⚪ 資料讀取失敗';
      el('riskSummary').textContent='資料檔可能尚未發布或格式有誤。'+String(error.message||error);
    }
  };
  el('riskRefresh')?.addEventListener('click',window.loadMarketRisk);
})();
