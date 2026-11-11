# Wealth v2 — iPhone PWA

## Deployment
1. **First export a JSON backup from the existing v1 app**. V2 does not know the old v1 localStorage schema and will not migrate it automatically. Keep the old backup private.
2. Upload the **contents** of this package (not the ZIP) into the existing GitHub repository root, including `.github/workflows/market.yml` and `data/market.json`.
3. Keep existing `apple-touch-icon.png` and `icon-512.png` files; this package intentionally does not replace them.
4. GitHub Settings → Pages → Deploy from branch → `main` / `(root)`.
5. GitHub Actions → Refresh delayed market prices → Run workflow. In Settings → Actions → General, ensure workflow permissions allow write access; otherwise quotes cannot be committed.
6. Open the GitHub Pages URL in Safari. Add to Home Screen.

## Important data notes
- This version uses a **new** localStorage key `marlowe_wealth_v2` and does not delete v1 data. However, iOS website storage can be cleared by the system or user. Export backups regularly.
- Seed quantities/costs are **historical, unverified estimates**, not broker-verified live balances. `00646` cost is inferred. VOO 0.06109 shares and US$43.04 cost only; a planned additional share is NOT included. No 0050 is seeded.
- Yahoo chart API may rate-limit or change without notice. The GitHub workflow keeps the most recently verified dated close if the fetch fails, so always check the **price date**. Free feed is delayed and not guaranteed.
- Funds are intentionally NOT auto-valued until exact share classes and verifiable NAV endpoints are configured. Their initial units and costs require reconciliation. No fictitious NAVs are included.
- V2 P&L is **unrealized P&L on covered positions only**, using current FX for USD cost conversion. It is not historical FX-adjusted performance and does not include realized gains, taxes, or all fees.
- The website is public, and `data/market.json` contains **public market quotes only**. Do not commit private holdings or backups to GitHub. Private portfolio records stay in the user's local browser storage.
- Market data is not investment advice. Yahoo Finance may have data-use restrictions; verify suitability before production use.
