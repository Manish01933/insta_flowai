#!/usr/bin/env node
/**
 * Customer health card for one tenant.
 *
 * Answers the only question a support conversation actually starts with: "is
 * this customer's bot working?" in a single command, instead of opening five
 * screens or guessing from a screenshot.
 *
 * Usage:
 *   node scripts/check-tenant.mjs <tenantId> --as-you                 # easiest: sign in as yourself
 *   node scripts/check-tenant.mjs <tenantId> --token=<firebase-id-token>
 *   node scripts/check-tenant.mjs <tenantId> --url=http://localhost:3000 --as-you
 *   node scripts/check-tenant.mjs <tenantId> --as-you --json          # raw payloads
 *
 * Where the tenant id comes from: it is the customer's Firebase user id (uid).
 * Firebase Console -> Authentication -> Users -> UID, or the "Tenant ID:" line
 * on the customer's own dashboard.
 *
 * Access: tenant data is only served to a verified Firebase user, and the ONLY
 * account allowed to read a *different* tenant is one listed in OWNER_TENANT_IDS
 * (yours). So one of these two is required:
 *
 *   --as-you   signs in with OPS_EMAIL / OPS_PASSWORD (prompted if unset) and
 *              uses that session's token. Nothing is stored on disk; the token
 *              lives only for this process. The password is only ever sent to
 *              Google's identity API, never to this app's server.
 *   --token=<firebase-id-token>
 *              bring your own token, e.g. from a browser:
 *              DevTools -> Application -> Local Storage -> `firebase:authUser:*`
 *              -> stsTokenManager.accessToken (valid ~1 hour).
 *
 * Every endpoint below is read-only; nothing here changes a customer's account.
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';

const args = process.argv.slice(2);
const value = (name) => {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : undefined;
};

const TENANT_ID = args.find((a) => !a.startsWith('--'));
const BASE_URL = (value('--url') || process.env.APP_URL || 'https://www.thefgt.in').replace(/\/+$/, '');
const AS_JSON = args.includes('--json');
const AS_YOU = args.includes('--as-you') || Boolean(process.env.OPS_EMAIL);
let TOKEN = value('--token') || process.env.ID_TOKEN || process.env.SMOKE_ID_TOKEN || '';

if (!TENANT_ID) {
  console.error('Usage: node scripts/check-tenant.mjs <tenantId> [--as-you | --token=<firebase-id-token>] [--url=...] [--json]');
  process.exit(1);
}

const authHeaders = { 'x-tenant-id': TENANT_ID };

/** The web API key the browser bundle already ships — public by design. */
const firebaseApiKey = () => {
  for (const candidate of ['firebase-applet-config.json', path.join('..', 'firebase-applet-config.json')]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (parsed?.apiKey) return String(parsed.apiKey);
    } catch {
      /* try the next candidate */
    }
  }
  return '';
};

const prompt = (question, silent) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (!silent) {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
      return;
    }
    // Ask on a line of its own, then mute readline's echo so the password never
    // lands in the scrollback of the terminal (or in a screen share).
    process.stdout.write(question);
    rl._writeToOutput = () => {};
    rl.question('', (answer) => {
      process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
  });

/**
 * Signs in so the caller does not have to paste a token that expires in an hour.
 * The password goes straight to Google's identity endpoint — this process holds
 * it in memory for the length of one request and never writes it anywhere.
 */
async function signInAsOperator() {
  const key = firebaseApiKey();
  if (!key) {
    console.error('  Could not read firebase-applet-config.json, so --as-you cannot sign in. Use --token instead.');
    return '';
  }
  const email = process.env.OPS_EMAIL || (await prompt('  Operator email: '));
  const password = process.env.OPS_PASSWORD || (await prompt('  Password (not echoed, not stored): ', true));
  if (!email || !password) return '';

  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: password, returnSecureToken: true }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const reason = data?.error?.message || `HTTP ${res.status}`;
    console.error(`  Sign-in failed: ${reason}`);
    return '';
  }
  if (!AS_JSON) console.log(`  Signed in as ${email} (uid ${data.localId})\n`);
  return data.idToken;
}

async function api(path) {
  try {
    const res = await fetch(`${BASE_URL}${path}`, { headers: authHeaders });
    const body = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, body };
  } catch (err) {
    return { status: 0, ok: false, error: err.message };
  }
}

const pad = (label) => `${label}${'.'.repeat(Math.max(1, 26 - label.length))}`;
const line = (label, val) => console.log(`  ${pad(label)} ${val}`);
const daysLeft = (iso) => {
  const end = Date.parse(iso || '');
  if (!Number.isFinite(end)) return null;
  return Math.ceil((end - Date.now()) / 86_400_000);
};

async function main() {
  if (!AS_JSON) {
    console.log(`\nCustomer account check - tenant ${TENANT_ID}`);
    console.log(`Target: ${BASE_URL}\n`);
  }

  if (!TOKEN && AS_YOU) TOKEN = await signInAsOperator();
  if (TOKEN) authHeaders.Authorization = `Bearer ${TOKEN}`;

  const [health, subscription, status, settings, gaps, leads, chats] = await Promise.all([
    api('/healthz'),
    api('/api/subscription'),
    api('/api/instagram/status'),
    api('/api/tenant-settings'),
    api('/api/kb-gaps'),
    api('/api/leads'),
    api('/api/inbox-chats'),
  ]);

  if (AS_JSON) {
    console.log(JSON.stringify({ TENANT_ID, BASE_URL, health, subscription, status, settings, gaps, leads, chats }, null, 2));
    return;
  }

  if (health.status === 0) {
    console.log(`  Could not reach ${BASE_URL}${health.error ? ` (${health.error})` : ''}\n`);
    return;
  }

  // Tenant data needs a verified sign-in token. Say so plainly rather than
  // printing a card full of empty fields that looks like a broken account.
  if (subscription.status === 401) {
    console.log(subscription.body?.code === 'INVALID_TOKEN'
      ? '  The credentials were rejected (expired token, or a wrong email/password). Try again with --as-you.\n'
      : '  This tool must sign in first: run it with --as-you (or pass --token=<firebase-id-token>).\n');
    return;
  }
  line('server build', health.body?.buildId || 'unknown');
  line('environment', health.body?.nodeEnv || 'unknown');

  const problems = [];
  const notes = [];

  // ---- Plan / trial -------------------------------------------------------
  const sub = subscription.body?.subscription || null;
  const access = subscription.body?.access || null;
  console.log('\nPlan & billing');
  if (!sub) {
    line('subscription', 'none (never started a trial or bought a plan)');
  } else {
    line('plan', `${sub.planId} (${sub.status})`);
    line('period ends', `${sub.currentPeriodEnd}  [${daysLeft(sub.currentPeriodEnd)} day(s) left]`);
    if (sub.trialUsedAt) line('trial used at', sub.trialUsedAt);
  }
  line('bot allowed', access ? `${access.allowed ? 'YES' : 'NO'} - ${access.reason}` : 'unknown (endpoint failed)');
  if (access && !access.allowed) problems.push(`Billing gate is closed: ${access.reason}`);

  // ---- Instagram connection ----------------------------------------------
  const conn = status.body || {};
  console.log('\nInstagram connection');
  line('connected', conn.isConnected ? `YES (@${conn.instagramUsername || '?'})` : 'NO');
  if (conn.isConnected) {
    line('account id', conn.instagramAccountId || 'unknown');
    if (conn.facebookPageName) line('linked page', conn.facebookPageName);
    line('connected at', conn.connectedAt || 'unknown');
    line('token verified', conn.lastVerifiedAt || 'never');
    line('booking link', conn.bookingUrl || 'not available');
  } else {
    problems.push('No Instagram account connected - the webhook cannot receive this customer\'s DMs');
  }
  if (conn.status === 'ERROR') problems.push(`Connection last reported an error: ${conn.lastError || 'unknown'}`);
  if (conn.oauthRedirectUri) line('oauth redirect', conn.oauthRedirectUri);
  if (conn.webhookUrl) line('webhook url', conn.webhookUrl);

  // ---- Bot knowledge ------------------------------------------------------
  const s = settings.body?.settings || {};
  const docs = Array.isArray(s.knowledgeItems) ? s.knowledgeItems : [];
  const gapList = Array.isArray(gaps.body?.gaps) ? gaps.body.gaps : [];
  console.log('\nBot knowledge');
  line('knowledge documents', String(docs.length));
  line('custom prompt', s.systemPrompt ? `yes (${String(s.systemPrompt).length} chars)` : 'no - using the default prompt');
  line('unanswered questions', String(gapList.length));
  if (docs.length === 0) problems.push('Knowledge base is empty - every reply will be generic');
  if (gapList.length) {
    notes.push(`${gapList.length} customer question(s) had no answer in the knowledge base`);
    gapList.slice(0, 3).forEach((g) => line('  top gap', `"${g.question}" x${g.count}`));
  }

  // ---- Leads --------------------------------------------------------------
  const leadList = Array.isArray(leads.body?.leads) ? leads.body.leads : [];
  const newLeads = leadList.filter((l) => l.status === 'new').length;
  console.log('\nLeads');
  line('leads captured', `${leadList.length} total, ${newLeads} new`);
  leadList.slice(0, 3).forEach((l) => {
    line('  latest', `${l.name || '?'} ${l.whatsapp || ''} - ${l.createdAt || ''} (${l.status})`);
  });

  // ---- Conversations ------------------------------------------------------
  const chatList = Array.isArray(chats.body?.chats) ? chats.body.chats : [];
  const takeovers = chatList.filter((c) => c.humanTakeover).length;
  console.log('\nConversations');
  line('stored chats', String(chatList.length));
  line('human takeover on', String(takeovers));
  if (takeovers) notes.push(`${takeovers} conversation(s) are paused for a human - the bot will not answer those`);
  chatList.slice(0, 3).forEach((c) => {
    const who = c.customerName || c.senderHandle || c.senderId || '?';
    line('  latest', `${who} - "${String(c.lastMessage || '').slice(0, 40)}"`);
  });

  // ---- Platform context ---------------------------------------------------
  console.log('\nPlatform');
  line('total tenants w/ plan', `${health.body?.activeSubscriptions ?? '?'} active, ${health.body?.trialingSubscriptions ?? '?'} trialing`);
  line('inbox conversations', String(health.body?.inboxConversations ?? '?'));

  // ---- Verdict ------------------------------------------------------------
  console.log('\nVerdict');
  if (problems.length === 0) {
    console.log('  Bot is live - plan/trial active and the Instagram account is connected.');
  } else {
    console.log('  Needs attention:');
    problems.forEach((p) => console.log(`   - ${p}`));
  }
  notes.forEach((n) => console.log(`   note: ${n}`));
  console.log('');
}

main();
