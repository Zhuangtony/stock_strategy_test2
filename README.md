# covered-call-backtester-next (App Router, lib-split)

Next.js 14 App Router project for comparing Buy&Hold vs Covered Call strategies.

## Features

- Parameterised backtests with adjustable target delta, roll settings, risk-free rate `r` and dividend yield `q` inputs.
- Comparison delta manager for plotting multiple Covered Call curves side-by-side.
- Rich chart experience with fullscreen mode, density controls, CSV export and roll markers.
- Yahoo proxy at `/api/yahoo` to avoid CORS.
- Tailwind, Recharts, Vitest.
- Backtest engine lives in `lib/backtest.ts` with exported types for strong typing between UI and core logic.

## Dev
```bash
npm i
npm run test
npm run dev
```

## Build
```bash
npm run build
```

## Deploy
Push to GitHub and import into Vercel.
