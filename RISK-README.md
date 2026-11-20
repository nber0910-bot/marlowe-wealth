# MONO MARKET RISK — V2
- 連點「總覽」切換模式。
- 每日 20:27 台灣時間由 GitHub Actions 執行 `update_risk.py`，產生 `risk.json`；需將此 ZIP 專案部署至 GitHub repository，啟用 Actions 且允許 workflow 寫入。
- 美國指標：VIXCLS、DGS10、BAMLH0A0HYM2 取自 FRED 公開 CSV；DXY 使用 Yahoo Finance 延遲資料。失敗時保留上次資料，超過五天不顯示綜合燈號。
- 台股外資買賣超已加入證交所 BFI82U 官方資料擷取（含最近五個交易日累計）；融資擔保維持率仍未找到同口徑穩定資料來源，明確顯示待更新。
- 所有數據是延遲/最近已公布數據，不是即時報價；市場燈號是簡化觀察，不構成買賣建議。
- `risk.json` 不包含任何個人投資資料。原資產管理與行情更新維持不變。
