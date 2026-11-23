# 021 Trade

021 Trade is a browser-only paper trading terminal for ten NSE equities. Each browser profile starts with ₹10,00,000 in simulated buying power. The terminal works without API keys, accounts, or a backend.

## Run locally

Use Node.js 22.13 or later and a current browser with IndexedDB and BroadcastChannel support.

```sh
npm ci
npm run dev
```

Open [the local terminal](http://127.0.0.1:5173). To verify the production bundle, run `npm run build` and `npm run preview`. Deploy the generated `dist/` directory to any static host. The included GitHub Actions workflow builds and publishes it when GitHub Pages uses **GitHub Actions** as the publishing source.

## Features

| View | What you can do |
| --- | --- |
| Watchlists | Create, rename, or delete lists. Search the ten-stock picker, add and remove stocks, and drag rows by the handle. To reorder with the keyboard, focus the handle, press Space or Enter, pick a destination with the arrow keys, and press Space or Enter to drop. Escape cancels. |
| Market | View LTP, price change, and percentage change for all ten NSE symbols. Changed prices flash green for an uptick and red for a downtick. Select a stock to see its price history and open the ticket. |
| Order ticket | Enter a whole-share market buy or sell. The ticket updates its estimate live, checks cash or available shares, and confirms the actual fill. Order history lists the newest fills first. |
| Holdings | See quantities, average cost, current value, and unrealized P&L. Sort by P&L, symbol, or value. Open a ticket from any holding. |
| Price alerts | Set a one-time above or below threshold. All crossed alerts appear as individual toasts and move into Triggered alerts. Delete either active or triggered alerts. |

## Implementation

- **Stack** — React, TypeScript, Vite, and CSS. A canvas draws the price chart, native controls handle forms and dialogs, and Playwright drives browser tests.
- **Market simulation** — The feed rotates through the ten stocks on a shared clock. Each symbol combines bounded, deterministic price waves with small per-tick changes. Percent change is measured from a fixed reference close. The initial IndexedDB transaction establishes the shared epoch, so active tabs on the same origin derive the same price for a given timestamp. Change `TICKS_PER_SECOND` in `src/market.ts` to tune the rate. It defaults to 60 tick slots per second across the market.
- **Rendering** — `useSyncExternalStore` subscriptions isolate quote updates to the affected price cells, chart, ticket, and holding row. Unchanged prices keep the same snapshot. Holdings recalculate live aggregates but only reorder the list when its sorted symbol sequence changes. The scheduler batches elapsed ticks and refreshes immediately when a tab becomes visible.
- **Money and fills** — Quotes use integer paise. Cash, values, and cost bases use `bigint`. The ticket captures the feed price at submission, then validates against the latest durable ledger inside the write transaction. Partial sales allocate the existing position cost pro rata to the nearest lower paise and preserve the remainder in the open position. Displayed average cost rounds independently of the total cost basis.
- **Persistence and synchronization** — IndexedDB holds the watchlists, wallet, orders, holdings, alerts, and market epoch. Read-modify-write operations share one transaction scope, so two tabs cannot spend the same cash or fill the same alert twice. A BroadcastChannel message carries the committed revision. Receiving tabs read the current snapshot without writing back. A tab also refreshes its account snapshot on focus or visibility changes.
- **Alert semantics** — A tick must move from strictly below or above the threshold to the threshold or beyond. Creating an alert while the price is already past its target waits for a fresh crossing. An alert's trigger is persisted before showing its toast. When tabs see the same crossing, the tab whose transaction wins displays the toast and all tabs show the triggered alert in the list.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

The six unit tests cover exact arithmetic, invalid orders, idempotency, reordering, alert boundaries, and deterministic market throughput. Browser tests exercise watchlist management and cross-tab sync, order submission and reload, competing orders, simultaneous alerts, portfolio valuation and sorting, and mobile layout. In a four-second desktop Chromium scroll sample, the terminal rendered 237 changed prices at a 16.8 ms 95th-percentile frame interval.

## Limitations

This simulator fills whole-share market orders immediately. It has no exchange connectivity, fees, or slippage. Workspace data is scoped to the browser profile and site origin. Price alerts are in-app only. An open tab can evaluate up to 15 minutes of elapsed ticks on return from the background. Crossing events while the app is closed are not delivered.
