/**
 * Customer-list logic tests (src/customerListLogic.ts) — pure, no server, no DB.
 * Run: npx tsx scripts/customer-list.test.ts   → expect exit 0
 */
import { strict as assert } from 'node:assert';
import {
  sortRows,
  filterRows,
  paginate,
  dayWindowMs,
  rowInDateWindow,
  localDateFromDayString,
  type ListRowLike,
  type DateFilter,
} from '../src/customerListLogic';

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; failures.push(name); console.error(`FAIL ${name}`); }
}

const NOW = new Date(2026, 9, 13, 12, 0, 0).getTime(); // local 2026-10-13 12:00
const iso = (y: number, m: number, d: number, hh = 12, mm = 0) => new Date(y, m - 1, d, hh, mm).toISOString();

const rows: ListRowLike[] = [
  { tenantId: 'b', createdAt: iso(2026, 10, 13, 23, 30), lastActivityAt: iso(2026, 10, 13, 23, 59) },
  { tenantId: 'a', createdAt: iso(2026, 10, 13, 9, 0), lastActivityAt: iso(2026, 10, 12, 10, 0) },
  { tenantId: 'c', createdAt: null, lastActivityAt: null },
  { tenantId: 'd', createdAt: 'not-a-date', lastActivityAt: iso(2026, 10, 13, 8, 0) },
  { tenantId: 'e', createdAt: iso(2026, 10, 11, 0, 30), lastActivityAt: null },
];

// 1. Newest-first default
{
  const sorted = sortRows(rows, { field: 'created', dir: 'desc' });
  check('newest first: late-evening row before morning row', sorted[0].tenantId === 'b');
  // 2. Stable tie-break + unknown ordering
  const tied: ListRowLike[] = [
    { tenantId: 'z', createdAt: iso(2026, 10, 5), lastActivityAt: null },
    { tenantId: 'y', createdAt: iso(2026, 10, 5), lastActivityAt: null },
  ];
  const sortedTied = sortRows(tied, { field: 'created', dir: 'desc' });
  check('tie-break sorts by tenant id', sortedTied[0].tenantId === 'y' && sortedTied[1].tenantId === 'z');
  check('unknown/invalid dates sort last in desc', sorted[sorted.length - 1].tenantId === 'd' || sorted[sorted.length - 1].tenantId === 'c');
}
// Oldest first
{
  const sorted = sortRows(rows, { field: 'created', dir: 'asc' });
  check('oldest first puts 11th before 13th', sorted.findIndex((r: ListRowLike) => r.tenantId === 'e') < sorted.findIndex((r: ListRowLike) => r.tenantId === 'b'));
  check('unknown dates still sort last in asc', sorted[sorted.length - 1] === rows.find((r) => r.tenantId === 'd') || sorted[sorted.length - 1] === rows.find((r) => r.tenantId === 'c'));
}
// 3. Last activity is a distinct field; missing activity not replaced by createdAt
{
  const sorted = sortRows(rows, { field: 'activity', dir: 'desc' });
  check('activity sort uses activity field', sorted[0].tenantId === 'b');
  check('row without activity is last in activity sort', sorted[sorted.length - 1].tenantId === 'e' || sorted[sorted.length - 1].tenantId === 'c');
}
// 4. Today/yesterday/day-boundary handling (local timezone)
{
  check('dayWindow today starts at local midnight', dayWindowMs('today', NOW).start === new Date(2026, 9, 13, 0, 0, 0, 0).getTime());
  check('dayWindow yesterday ends at today-midnight', dayWindowMs('yesterday', NOW).end === new Date(2026, 9, 13, 0, 0, 0, 0).getTime());
  // 23:30 YESTERDAY must not match "today"; 00:30 today must; 23:30 today must.
  check('23:30 yesterday not in today', !rowInDateWindow(
    { tenantId: 'y', createdAt: iso(2026, 10, 12, 23, 30), lastActivityAt: null },
    'created', { preset: 'today' }, NOW
  ));
  check('23:30 yesterday IS in yesterday', rowInDateWindow(
    { tenantId: 'y', createdAt: iso(2026, 10, 12, 23, 30), lastActivityAt: null },
    'created', { preset: 'yesterday' }, NOW
  ));
  check('00:30 today in today', rowInDateWindow(
    { tenantId: 'x', createdAt: iso(2026, 10, 13, 0, 30), lastActivityAt: null },
    'created', { preset: 'today' }, NOW
  ));
  check('invalid createdAt cannot match a day filter', !rowInDateWindow(rows[3], 'created', { preset: '30d' }, NOW));
  check('missing createdAt cannot match a day filter', !rowInDateWindow(rows[2], 'created', { preset: '30d' }, NOW));
  check('30d window includes 11 days.. within 30', rowInDateWindow(rows[4], 'created', { preset: '30d' }, NOW));
  check('all preset includes unknown dates', rowInDateWindow(rows[2], 'created', { preset: 'all' }, NOW));
}
// 5. Custom range: inclusive bounds + invalid input never matches
{
  check('localDateFromDayString bad input NaN', Number.isNaN(localDateFromDayString('2026-02-31')));
  const custom: DateFilter = { preset: 'custom', from: '2026-10-11', to: '2026-10-13' };
  check('custom includes both bounds', rowInDateWindow(rows[4], 'created', custom, NOW) && rowInDateWindow(rows[0], 'created', custom, NOW));
  check('custom excludes outside', !rowInDateWindow(
    { tenantId: 'x', createdAt: iso(2026, 10, 10, 23, 0), lastActivityAt: null },
    'created', custom, NOW
  ));
  check('custom with invalid from never matches', !rowInDateWindow(rows[4], 'created', { preset: 'custom', from: 'oops', to: '2026-10-13' }, NOW));
}
// 6–7. filter + pagination composition, no skips/duplicates
{
  const many: ListRowLike[] = Array.from({ length: 25 }, (_, index) => ({
    tenantId: `t${String(index).padStart(2, '0')}`,
    createdAt: iso(2026, 10, 12 - (index % 10), index % 24),
    lastActivityAt: null,
  }));
  const sorted = sortRows(many, { field: 'created', dir: 'desc' });
  const p1 = paginate(sorted, 1, 10);
  const p2 = paginate(sorted, 2, 10);
  const p3 = paginate(sorted, 3, 10);
  const seen = new Set([...p1.items, ...p2.items, ...p3.items].map((row: ListRowLike) => row.tenantId));
  check('pagination covers all rows without duplicates', seen.size === many.length);
  check('page clamps beyond the last', paginate(sorted, 99, 10).page === 3);
  check('empty page 1 of empty list ok', paginate([], 1, 10).pages === 1);
  // Sort-change does not skip rows: every page boundary recomputed from same sorted list
  const p1v2 = paginate(sortRows(many, { field: 'created', dir: 'asc' }), 1, 10);
  check('re-sort + re-page stable', p1v2.items.length === 10);
}

console.log(`\n${fail === 0 ? 'ALL TESTS PASSED' : 'FAILURES'}`);
console.log(`passed=${pass} failed=${fail}`);
if (fail > 0) {
  console.error('Failed checks:', failures.join(', '));
  process.exit(1);
}
