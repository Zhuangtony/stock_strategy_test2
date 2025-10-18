# covered-call-backtester-next (App Router, lib-split)

Next.js 14 App Router project for comparing Buy&Hold vs Covered Call strategies.
- Yahoo proxy at `/api/yahoo` to avoid CORS.
- Tailwind, Recharts, Vitest.
- **No named exports inside `app/page.tsx`** (moved to `lib/*`) to satisfy Next.js rules.

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
