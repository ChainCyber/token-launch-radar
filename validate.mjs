// Validation script for the token-radar build (run from the repo root).
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { buildDossier } from './vendor/makefun-board.ts';

const snap = JSON.parse(readFileSync(process.env.HOME + '/workspace/makefun/token-radar-01-kit/input/snapshot.json', 'utf8'));
const board = JSON.parse(readFileSync('out/board.json', 'utf8'));
const rows = board.rows;
const fails = [];
const check = (ok, msg) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + msg); if (!ok) fails.push(msg); };

check(rows.length >= 100 && rows.length <= 4000, `rows ${rows.length} in 100..4000`);
check(new Set(rows.map((r) => r.slug)).size === rows.length, 'all slugs unique');
const known = new Set(snap.protocols.map((p) => p.slug));
check(rows.every((r) => known.has(r.slug)), 'every slug in the snapshot');
const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
check(ranks.every((r, i) => r === i + 1), 'ranks exactly 1..N');
const byRank = [...rows].sort((a, b) => a.rank - b.rank);
check(byRank.every((r, i) => i === 0 || r.implied_value_usd < byRank[i - 1].implied_value_usd), 'implied strictly decreasing with rank');
check(byRank.every((r) => Number.isSafeInteger(r.implied_value_usd) && r.implied_value_usd > 0 && r.implied_value_usd <= 1e14), 'implied positive whole <=1e14');
check(byRank[0].implied_value_usd !== byRank[byRank.length - 1].implied_value_usd, 'implied values not all equal');
const have = new Set(rows.map((r) => r.slug));
check(snap.watchlist.every((s) => have.has(s)), `all ${snap.watchlist.length} watchlist slugs present`);
check(rows.every((r) => Array.isArray(r.farm_steps) && r.farm_steps.length >= 3 && r.farm_steps.length <= 12), 'farm_steps 3..12 per row');
check(rows.every((r) => r.farm_steps.every((s) => typeof s === 'string' && s.trim().length >= 20 && s.trim().length <= 600)), 'farm_steps 20..600 chars trimmed');
check(statSync('out/board.json').size <= 8 * 1024 * 1024, `board.json ${statSync('out/board.json').size} bytes <= 8 MiB`);

// Dossier byte-match: rebuild and compare with out/dossier.json.
const rebuilt = buildDossier('out', { text_max_bytes: 65536, screenshots: { max: 4, max_bytes: 524288 }, dashboard: { max_files: 400, max_bytes: 4194304 } });
const written = readFileSync('out/dossier.json');
check(Buffer.compare(Buffer.from(rebuilt), written) === 0, `dossier byte-identical (${written.length} bytes)`);
check(written.length <= 1.5 * 1024 * 1024, `dossier.json ${written.length} bytes <= 1.5 MiB`);

// Dashboard caps and no-network rule.
const dashFiles = readdirSync('dashboard');
const dashBytes = dashFiles.reduce((n, f) => n + statSync('dashboard/' + f).size, 0);
check(dashBytes < 65536, `dashboard total ${dashBytes} bytes < 65536`);
let urls = false;
for (const f of dashFiles) if (/(https?:\/\/)/.test(readFileSync('dashboard/' + f, 'utf8'))) { urls = true; console.log('  URL in', f); }
check(!urls, 'no http:// or https:// strings in dashboard/');

// Screenshots.
const shots = readdirSync('screenshots').filter((f) => !f.startsWith('.'));
check(shots.length === 3, `3 screenshots (${shots.join(', ')})`);
for (const f of shots) {
  const sz = statSync('screenshots/' + f).size;
  check(sz <= 512 * 1024, `${f} ${sz} bytes <= 512 KiB`);
}
console.log('TOP 5:');
for (const r of byRank.slice(0, 5)) console.log(`  #${r.rank} ${r.slug} (${r.name}) $${r.implied_value_usd.toLocaleString('en-US')}`);
console.log(fails.length ? `VALIDATION FAILED: ${fails.length} check(s)` : 'ALL CHECKS PASSED');
process.exit(fails.length ? 1 : 0);
