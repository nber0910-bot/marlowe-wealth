(function(){
  'use strict';
  const fields=[['vix','VIX','恐慌指數',''],['dxy','DXY','美元指數',''],['us10y','US10Y','美債10年殖利率','%'],['hyspread','HY SPREAD','高收益債利差','%'],['margin','MARGIN','融資維持率','%'],['foreign','FOREIGN','外資買賣超','億元']];
  const el=id=>document.getElementById(id);
  const esc=x=>String(x??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function tiles(m){
    const grid=el('riskGrid'); if(!grid)return;
    grid.innerHTML=fields.map(([k,n,label,u])=>{
      const d=m[k]||{}, value=typeof d.value==='number'&&Number.isFinite(d.value)?d.value:null;
      return `<div class="risk-tile"><small>${label}</small><strong>${value===null?'—':value.toLocaleString('zh-TW')+u}</strong><small>${n} · ${esc(d.date||'待更新')}<br>${esc(d.source||'資料待串接')}${Number.isFinite(d.sum_5d)?'<br>近5日累計 '+d.sum_5d+' 億元':''}</small></div>`;
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
