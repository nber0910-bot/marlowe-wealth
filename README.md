# MARLOWE Wealth v1

可離線使用的繁體中文 iPhone PWA，靜態 HTML/CSS/JavaScript，無需建置流程。

## 使用與部署
1. 將整個資料夾上傳到 GitHub repository。
2. 在 Settings > Pages 選擇 Deploy from a branch，選 main / root；等待 HTTPS 網址生效。
3. 在 iPhone Safari 開啟該 HTTPS 網址，點分享 > 加入主畫面。
4. 設定 USD/TWD，為每檔填入最新價格和日期；在「持倉」校正待確認成本與數量。
5. 每次交易後於「交易」新增買入／賣出；定期匯出 JSON 備份。

也可使用 Netlify Drop 將資料夾部署成 HTTPS 靜態網站。單純在手機開啟本機 HTML 不等同已安裝 PWA。

## 已知資料與限制
- 2026-11-11 009816 1,205 股；00646 281 股。完整成本未經確認，設為 null。
- 0050 個人買入已提及，但持股數量、完整成本未確認，設為 null。
- VOO 0.06109 股，成本 USD 43.04；不將尚未確認的 1 股購買計入。
- 4 檔基金：富邦標普500 3307.47 單位 / NT$36700；富邦NASDAQ-100 2705.29 / NT$31000；元大新主流 133.5 / NT$24800；元大台灣高股息優質龍頭 212.8 / NT$7539。以上為過往紀錄，需核對是否有後續變動。
- 2026-11-11 009816 459 股 × 15.25；00646 13 股 × 78.40，已包含於期初總數，不重複計入交易。費用待確認。
- 所有市價、基金淨值、USD/TWD 皆為空值；不捏造即時行情。第一版需手動更新行情。
- 使用 localStorage，沒有雲端同步、銀行/券商連線、帳戶登入；清除網站資料會丟失未備份資料。
- 成本為原幣，美元成本以目前匯率轉換僅作粗略比較，不代表實際匯兌損益；美股交易的成交匯率會記錄但目前未用於台幣歷史成本計算。
- 移動平均成本法；賣出已實現損益、稅、配息、手續費細分尚未完整實作，需第二版補強。
- 價格缺失時顯示已估值小計而非完整總資產。

## 資料結構
localStorage key `marlowe-wealth-v1`，JSON 內含 version, fx, assets[{id,name,cat,qty,cost,price,priceDate,note}], trades[{id,asset,type,qty,price,fee,fx,date}], snapshots[{date,total,covered,all}], reference[]。
