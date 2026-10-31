/**
 * Customer list ordering/filtering logic — PURE functions, shared by the Ops
 * Console table and by its Node tests (npx tsx scripts/customer-list.test.ts).
 *
 * Rules enforced here (Feature 2):
 *  - Sorting NEVER compares formatted/localized date strings — only parsed
 *    epoch values (Date.parse), or null.
 *  - Default order = newest-first by registration timestamp; ties break on
 *    tenantId so pagination can never duplicate or skip a row.
 *  - Missing/invalid timestamps ("unknown date") always sort LAST
 *    deterministically — never between real values, in either direction.
 *  - Day filters ("today"/"yesterday") use LOCAL day boundaries (not UTC
 *    slicing), so a customer never shifts into the wrong date by timezone
 *    conversion; inputs that are missing or non-finite can never match a day
 *    window except with the "all" preset.
 *  - "Last activity" is a distinct field and must be labelled separately; when
 *    activity data is absent it is NOT silently replaced by createdAt.
 */

export type SortField = 'created' | 'activity';
export type SortDir = 'desc' | 'asc';

export interface ListRowLike {
  tenantId: string;
  /** Registration timestamp (ISO) or null when unknown. */
  createdAt: string | null;
  /** Last recorded activity (ISO) or null when never observed. */
  lastActivityAt: string | null;
}

export interface SortOption {
  field: SortField;
  dir: SortDir;
}

/** Stable sort: epoch compare + tenantId tie-break; unknown dates sort last. */
export function sortRows<T extends ListRowLike>(rows: readonly T[], option: SortOption): T[] {
  const dirFactor = option.dir === 'desc' ? -1 : 1;
  const parsed = (value: string | null): number | null => {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  };
  return rows
    .map((row) => ({
      row,
      time: parsed(option.field === 'created' ? row.createdAt : row.lastActivityAt),
    }))
    .sort((a, b) => {
      // Missing/invalid timestamps always sort AFTER every real value,
      // regardless of direction (deterministic, never interleaved).
      if (a.time === null && b.time === null) return a.row.tenantId.localeCompare(b.row.tenantId);
      if (a.time === null) return 1;
      if (b.time === null) return -1;
      if (a.time !== b.time) return (a.time - b.time) * dirFactor;
      return a.row.tenantId.localeCompare(b.row.tenantId);
    })
    .map((entry) => entry.row);
}

export type DatePreset = 'all' | 'today' | 'yesterday' | '7d' | '30d' | 'custom';

export interface DateFilter {
  preset: DatePreset;
  /** ISO date strings (yyyy-mm-dd) — only used when preset === 'custom'. */
  from?: string;
  to?: string;
}

/** Local-midnight boundary helpers. Epoch math, never string slicing. */
export function startOfLocalDay(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Inclusive [start, end] window in ms for a preset, computed from `now`. */
export function dayWindowMs(preset: Exclude<DatePreset, 'all' | 'custom'>, now: number): { start: number; end: number } {
  const todayStart = startOfLocalDay(now);
  const day = 24 * 3600_000;
  switch (preset) {
    case 'today':
      return { start: todayStart, end: todayStart + day };
    case 'yesterday':
      return { start: todayStart - day, end: todayStart };
    case '7d':
      return { start: todayStart - 6 * day, end: todayStart + day };
    case '30d':
      return { start: todayStart - 29 * day, end: todayStart + day };
  }
}

/** Parse an yyyy-mm-dd local date string to an epoch at local midnight (NaN if bad). */
export function localDateFromDayString(value: string | undefined): number {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const [y, m, d] = value.split('-').map((part) => parseInt(part, 10));
  const date = new Date(y, m - 1, d, 0, 0, 0, 0);
  // Reject rollovers (e.g. 2026-02-31) so a bad custom value never matches.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return NaN;
  return date.getTime();
}

/**
 * Does this row fall in the window for the requested field? A row whose
 * timestamp for the field is missing/invalid NEVER matches a date filter
 * (only the "all" preset shows it) — it is never silently re-dated.
 */
export function rowInDateWindow(
  row: ListRowLike,
  field: SortField,
  filter: DateFilter,
  now: number
): boolean {
  if (filter.preset === 'all') return true;
  const raw = field === 'created' ? row.createdAt : row.lastActivityAt;
  if (!raw) return false;
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return false;
  if (filter.preset === 'custom') {
    const from = localDateFromDayString(filter.from);
    const to = localDateFromDayString(filter.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return false; // invalid custom range never matches
    const toInclusive = to + 24 * 3600_000; // inclusive end day
    return ts >= from && ts < toInclusive;
  }
  if (filter.preset === 'today' || filter.preset === 'yesterday' || filter.preset === '7d' || filter.preset === '30d') {
    const { start, end } = dayWindowMs(filter.preset, now);
    return ts >= start && ts < end;
  }
  return false;
}

export function filterRows<T extends ListRowLike>(
  rows: readonly T[],
  field: SortField,
  filter: DateFilter,
  now: number
): T[] {
  return rows.filter((row) => rowInDateWindow(row, field, filter, now));
}

export interface Page<T> {
  items: T[];
  page: number;
  pages: number;
  total: number;
}

/** Stable pagination over an ALREADY-SORTED list; page is clamped (no skips). */
export function paginate<T>(rows: readonly T[], page: number, pageSize: number): Page<T> {
  const size = Math.max(1, Math.floor(pageSize));
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page)), pages);
  const start = (current - 1) * size;
  return { items: rows.slice(start, start + size), page: current, pages, total };
}
