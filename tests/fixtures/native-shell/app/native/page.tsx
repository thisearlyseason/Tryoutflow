import { redirect } from 'next/navigation';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export const dynamic = 'force-dynamic';
const allowed = new Set([
  '/app/local/home',
  '/app/local/setup/basics',
  '/app/local/evaluate/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  '/app/local/charts',
  '/app/local/rankings',
  '/app/local/exports',
  '/app/local/plot',
]);
export default function Native() {
  let route = '/app/local/home';
  try {
    const data = JSON.parse(
      readFileSync(
        join(process.cwd(), 'tests/fixtures/native-shell/native-start-route.json'),
        'utf8',
      ),
    );
    if (allowed.has(data.route)) route = data.route;
  } catch {}
  redirect(route);
}
