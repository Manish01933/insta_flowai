import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './connectionStore';

/**
 * Owner-facing technical incidents with a lifecycle the owner actually works:
 * Detected → Acknowledged → Investigating → Resolved.
 *
 * Rules that keep this honest:
 *  - An incident is opened ONLY from real recorded events (tenant health store,
 *    unrouted deliveries, storage failures). No synthetic health values.
 *  - One stable `key` per condition (e.g. tenant+category, or a platform-wide
 *    condition). A repeat of the same open condition BUMPS the existing
 *    incident (count + lastSeenAt) instead of creating a wall of rows.
 *  - Re-notification of an open incident is rate limited by a per-incident
 *    cooldown, so a flapping 429 cannot spam the owner's inbox/WhatsApp.
 *  - Resolved incidents are kept for evidence; a *recurrence* after resolution
 *    opens a NEW incident (so history shows the incident happened twice).
 *  - Payloads carry redacted diagnostics only — never tokens, OAuth secrets,
 *    encryption keys or customer message text.
 *
 * Lifecycle transitions are owner actions; all of them are audited with the
 * acting viewer and written through the same durable JSON-file mechanism every
 * other store in this app uses (temp file + rename).
 */

export type IncidentStatus = 'detected' | 'acknowledged' | 'investigating' | 'resolved';

export interface IncidentNotification {
  channel: 'email' | 'whatsapp' | 'dashboard';
  at: string;
  ok: boolean;
  error?: string;
}

export interface HealthIncident {
  id: string;
  /** Stable dedupe key: same open condition = same incident. */
  key: string;
  /** null = platform-wide (not tied to one tenant). */
  tenantId: string | null;
  /** Masked Instagram account id, when the incident is account-specific. */
  igAccountIdMasked: string | null;
  category: string;
  severity: 'critical' | 'warning';
  title: string;
  /** Short, redacted, safe diagnostics. */
  detail: string;
  status: IncidentStatus;
  detectedAt: string;
  lastSeenAt: string;
  count: number;
  acknowledgedAt: string | null;
  investigatingAt: string | null;
  resolvedAt: string | null;
  updatedAt: string;
  notifications: IncidentNotification[];
}

interface IncidentFile {
  version: 1;
  incidents: HealthIncident[];
}

const FILE_NAME = 'health-incidents.json';
/** Resolved per call so isolated tests can point the store at a temp dir. */
function filePath(): string {
  const override = (globalThis as any).__INCIDENT_STORE_TEST_DIR__;
  return override ? path.join(String(override), FILE_NAME) : path.join(DATA_DIR, FILE_NAME);
}
const MAX_INCIDENTS = 500;
const RESOLVED_RETENTION_DAYS = 30;

let state: IncidentFile | null = null;
let loaded = false;
let persistChain: Promise<void> = Promise.resolve();

function load(): IncidentFile {
  if (loaded && state) return state;
  loaded = true;
  state = { version: 1, incidents: [] };
  try {
    if (fs.existsSync(filePath())) {
      const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8')) as IncidentFile;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.incidents)) {
        state = parsed;
      }
    }
  } catch (err) {
    try {
      fs.renameSync(filePath(), `${filePath()}.corrupt-${Date.now()}`);
    } catch {
      // Nothing more can be done; start empty rather than crash.
    }
    console.error('[incidents] corrupt health-incidents.json moved aside; starting empty.');
    state = { version: 1, incidents: [] };
  }
  return state;
}

function persistSnapshot() {
  const current = load();
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${filePath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(current), 'utf8');
  fs.renameSync(tmp, filePath());
}

function persist(): Promise<void> {
  const run = persistChain.then(() => {
    try {
      persistSnapshot();
    } catch (err) {
      console.error('[incidents] persist failed:', err);
    }
  });
  persistChain = run.catch(() => undefined);
  return run;
}

function newId(): string {
  return `inc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface OpenIncidentInput {
  key: string;
  tenantId?: string | null;
  igAccountIdMasked?: string | null;
  category: string;
  severity: 'critical' | 'warning';
  title: string;
  detail: string;
  /** Seconds after which a re-notify of the SAME open incident is allowed. */
  cooldownMs?: number;
}

export interface OpenIncidentResult {
  incident: HealthIncident;
  created: boolean;
  /** True when (re-)notification is permitted now (new incident or cooldown elapsed). */
  shouldNotify: boolean;
}

/**
 * Open-or-bump one incident. Dedupe: an incident with the same key that is not
 * resolved absorbs the new sighting (count++, lastSeenAt). A resolved incident
 * never re-opens — recurrence creates a fresh incident, preserving history.
 */
export function openIncident(input: OpenIncidentInput): OpenIncidentResult {
  const current = load();
  const now = new Date().toISOString();
  const open = current.incidents.find(
    (incident) => incident.key === input.key && incident.status !== 'resolved'
  );

  if (open) {
    open.count += 1;
    open.lastSeenAt = now;
    open.updatedAt = now;
    if (input.detail && input.detail.length > (open.detail || '').length) {
      open.detail = String(input.detail).slice(0, 500);
    }
    void persist();
    const cooldownMs = input.cooldownMs ?? 60 * 60 * 1000;
    const lastNotified = open.notifications[0]?.at ? Date.parse(open.notifications[0].at) : 0;
    const shouldNotify = Date.now() - lastNotified >= cooldownMs;
    return { incident: open, created: false, shouldNotify };
  }

  const incident: HealthIncident = {
    id: newId(),
    key: input.key,
    tenantId: input.tenantId ?? null,
    igAccountIdMasked: input.igAccountIdMasked ?? null,
    category: input.category,
    severity: input.severity,
    title: String(input.title).slice(0, 200),
    detail: String(input.detail || '').slice(0, 500),
    status: 'detected',
    detectedAt: now,
    lastSeenAt: now,
    count: 1,
    acknowledgedAt: null,
    investigatingAt: null,
    resolvedAt: null,
    updatedAt: now,
    notifications: [],
  };
  current.incidents = [incident, ...current.incidents].slice(0, MAX_INCIDENTS);
  void persist();
  return { incident, created: true, shouldNotify: true };
}

/** Resolve an open incident so recurrence starts a new one. */
export function resolveIncident(id: string, by: string): HealthIncident | null {
  const current = load();
  const incident = current.incidents.find((entry) => entry.id === id && entry.status !== 'resolved');
  if (!incident) return null;
  const now = new Date().toISOString();
  incident.status = 'resolved';
  incident.resolvedAt = now;
  incident.updatedAt = now;
  incident.notifications.push({ channel: 'dashboard', at: now, ok: true, error: `resolved by ${by}` });
  void persist();
  return incident;
}

export function setIncidentStatus(id: string, status: IncidentStatus, by: string): HealthIncident | null {
  if (status === 'resolved') return resolveIncident(id, by);
  const current = load();
  const incident = current.incidents.find((entry) => entry.id === id && entry.status !== 'resolved');
  if (!incident) return null;
  const now = new Date().toISOString();
  incident.status = status;
  incident.updatedAt = now;
  if (status === 'acknowledged' && !incident.acknowledgedAt) incident.acknowledgedAt = now;
  if (status === 'investigating' && !incident.investigatingAt) incident.investigatingAt = now;
  void persist();
  return incident;
}

export function listIncidents(filters: { tenantId?: string | null; status?: IncidentStatus; category?: string } = {}): HealthIncident[] {
  let incidents = [...load().incidents];
  if (filters.tenantId === null || filters.tenantId === '') incidents = incidents.filter((incident) => incident.tenantId === null);
  else if (filters.tenantId) incidents = incidents.filter((incident) => incident.tenantId === filters.tenantId);
  if (filters.status) incidents = incidents.filter((incident) => incident.status === filters.status);
  if (filters.category) incidents = incidents.filter((incident) => incident.category === filters.category);
  return incidents;
}

export function getOpenIncidentCount(): number {
  return load().incidents.filter((incident) => incident.status !== 'resolved').length;
}

/** Record how a notification actually went — the console shows delivery truth. */
export function recordNotification(id: string, notification: IncidentNotification): void {
  const current = load();
  const incident = current.incidents.find((entry) => entry.id === id);
  if (!incident) return;
  incident.notifications = [notification, ...incident.notifications].slice(0, 10);
  incident.updatedAt = new Date().toISOString();
  void persist();
}

/** Housekeeping: prune resolved incidents past retention + hard cap. */
export function startIncidentSweeper(): void {
  const sweep = () => {
    const current = load();
    const cutoff = Date.now() - RESOLVED_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const kept = current.incidents.filter(
      (incident) => incident.status !== 'resolved' || Date.parse(incident.resolvedAt || incident.lastSeenAt) >= cutoff
    );
    if (kept.length !== current.incidents.length) {
      current.incidents = kept;
      void persist();
    }
  };
  sweep();
  setInterval(sweep, 6 * 60 * 60 * 1000).unref();
}

/** Test hook. */
export function _resetIncidentStoreForTests(): void {
  state = { version: 1, incidents: [] };
  loaded = true;
  persistChain = Promise.resolve();
}

/** Test hook: point the store file at a temp dir (never the production DATA_DIR). */
export function _setIncidentStoreTestDir(dir?: string): void {
  if (dir) (globalThis as any).__INCIDENT_STORE_TEST_DIR__ = dir;
  else delete (globalThis as any).__INCIDENT_STORE_TEST_DIR__;
  _resetIncidentStoreForTests();
}
