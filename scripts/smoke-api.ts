/*
  Smoke test for the App Router API handler without running the server.
  It imports GET from app/api/yahoo/route.ts, crafts a Request, and prints a short summary.
*/
import { GET } from '../app/api/yahoo/route';

async function main() {
  const symbol = process.argv[2] || 'AAPL';
  const start = process.argv[3] || '2018-01-01';
  const end = process.argv[4] || new Date().toISOString().slice(0, 10);
  const url = `http://localhost/api/yahoo?symbol=${encodeURIComponent(symbol)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const req = new Request(url);
  const res = await GET(req);
  if (!('json' in res)) throw new Error('Unexpected response');
  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  console.log({ rows: data.rows?.length, earningsDates: data.earningsDates?.length });
}

main().catch((e) => {
  console.error('API smoke failed:', e?.message || e);
  process.exit(1);
});

