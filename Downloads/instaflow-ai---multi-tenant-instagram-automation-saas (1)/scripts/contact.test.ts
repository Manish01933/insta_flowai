/**
 * Contact form tests — Feature: mandatory Contact Person + WhatsApp,
 * Instagram account replaces manual Business Name.
 *
 * ALL state in OS temp dirs; no real DATA_DIR touched, no provider call,
 * no Instagram message, no WhatsApp send.
 * Run: npx tsx scripts/contact.test.ts → expect exit 0
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean): void {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; failures.push(name); console.error(`FAIL ${name}`); }
}

// Isolate data dir before importing stores.
const root = mkdtempSync(path.join(tmpdir(), 'contact-'));
process.env.DATA_DIR = root;

const contactStore = await import('../server/contactStore');

const {
  saveContact,
  getContact,
  validateContactInput,
  normalizePhone,
  maskPhone,
  optOut,
  hasWhatsAppConsent,
  _resetForTests: resetContacts,
} = contactStore;

function resetAll(dir: string): void {
  resetContacts(dir);
}

function newDir(name: string): string {
  return mkdtempSync(path.join(tmpdir(), `ct-${name}-`));
}

// ============================================================ TEST 1: Phone normalization
{
  const dir = newDir('phone'); resetAll(dir);
  check('full E.164 accepted', normalizePhone('+919876543210').e164 === '+919876543210');
  check('formatted international accepted', normalizePhone('+91 98765 43210').e164 === '+919876543210');
  check('bare Indian mobile gets +91', normalizePhone('9876543210').e164 === '+919876543210');
  check('garbage rejected with reason', normalizePhone('call me maybe').e164 === null && Boolean(normalizePhone('call me maybe').reason));
  check('too-short rejected', normalizePhone('12345').e164 === null);
  check('masked shows country code + last 4 only', maskPhone('+919876543210').includes('3210') && !maskPhone('+919876543210').includes('98765'));
}

// ============================================================ TEST 2: Required-field validation
{
  const dir = newDir('validate'); resetAll(dir);

  // contactPerson mandatory
  const noPerson = validateContactInput({ contactPerson: '', whatsappNumber: '+91 98765 43210' });
  check('contactPerson empty rejected', !noPerson.ok && noPerson.errors.some((e) => /contact person/i.test(e)));

  // whatsappNumber mandatory
  const noPhone = validateContactInput({ contactPerson: 'Rahul', whatsappNumber: '' });
  check('whatsappNumber empty rejected', !noPhone.ok && noPhone.errors.some((e) => /whatsapp/i.test(e)));

  // invalid phone rejected
  const badPhone = validateContactInput({ contactPerson: 'Rahul', whatsappNumber: 'nope' });
  check('invalid whatsapp rejected', !badPhone.ok && badPhone.errors.length > 0);

  // businessName optional
  const noBusiness = validateContactInput({ contactPerson: 'Rahul', whatsappNumber: '+91 98765 43210' });
  check('businessName optional passes', noBusiness.ok);

  // all valid
  const good = validateContactInput({ contactPerson: 'Rahul Sharma', whatsappNumber: '+91 98765 43210', language: 'hi', email: 'rahul@example.com' });
  check('valid input passes', good.ok && (good as any).patch.contactPerson === 'Rahul Sharma' && (good as any).patch.whatsappNumber === '+919876543210');
}

// ============================================================ TEST 3: Save + retrieve (tenant isolation)
{
  const dir = newDir('save'); resetAll(dir);

  const saved = saveContact('T1', {
    contactPerson: 'Rahul Sharma',
    whatsappNumber: '+919876543210',
    language: 'hi',
    consent: { given: true, source: 'customer-self-service' },
  });
  check('save returns the record', saved.contactPerson === 'Rahul Sharma' && saved.whatsappNumber === '+919876543210');
  check('save records consent', saved.consent.given === true && !!saved.consent.at);
  check('save records createdAt', !!saved.createdAt && !!saved.updatedAt);

  const got = getContact('T1');
  check('getContact returns saved record', got?.contactPerson === 'Rahul Sharma' && got?.whatsappNumber === '+919876543210');
  check('tenant isolation — other tenant sees nothing', getContact('T2') === null);
}

// ============================================================ TEST 4: Instagram fields saved + retrieved
{
  const dir = newDir('instagram'); resetAll(dir);

  const saved = saveContact('T3', {
    contactPerson: 'Priya',
    whatsappNumber: '+91 98765 43210',
    instagramUsername: '@priya.salon',
    instagramAccountId: '17841400000000123',
    instagramStatus: 'CONNECTED',
    instagramConnectedAt: new Date().toISOString(),
    consent: { given: true, source: 'customer-self-service' },
  });
  check('instagramUsername saved', saved.instagramUsername === '@priya.salon');
  check('instagramAccountId saved', saved.instagramAccountId === '17841400000000123');
  check('instagramStatus saved', saved.instagramStatus === 'CONNECTED');
  check('instagramConnectedAt saved', Boolean(saved.instagramConnectedAt));

  const got = getContact('T3');
  check('instagram fields round-trip through getContact', got?.instagramUsername === '@priya.salon' && got?.instagramAccountId === '17841400000000123');
}

// ============================================================ TEST 5: Instagram saved from connect (real Meta values)
{
  const dir = newDir('connect'); resetAll(dir);

  // Simulates what /api/instagram/connect does after a real Meta verification:
  saveContact('T4', {
    contactPerson: 'Amit',
    whatsappNumber: '+91 91234 56789',
    instagramUsername: '@amit_store',
    instagramAccountId: '17841400000000999',
    instagramStatus: 'CONNECTED',
    instagramConnectedAt: new Date().toISOString(),
    consent: { given: true, source: 'customer-self-service' },
  });

  const got = getContact('T4');
  check('real Meta username stored (not guessed)', got?.instagramUsername === '@amit_store');
  check('real Meta account ID stored (not guessed)', got?.instagramAccountId === '17841400000000999');
}

// ============================================================ TEST 6: Contact Person + WhatsApp always required together
{
  const dir = newDir('required'); resetAll(dir);

  // Missing contactPerson even when whatsappNumber present
  const c1 = validateContactInput({ whatsappNumber: '+91 98765 43210' });
  check('missing contactPerson rejected', !c1.ok);

  // Missing whatsappNumber even when contactPerson present
  const c2 = validateContactInput({ contactPerson: 'Amit' });
  check('missing whatsappNumber rejected', !c2.ok);

  // Both present passes
  const c3 = validateContactInput({ contactPerson: 'Amit', whatsappNumber: '+91 98765 43210' });
  check('both present passes', c3.ok);
}

// ============================================================ TEST 7: OPS display readiness
{
  const dir = newDir('ops'); resetAll(dir);

  // Simulates the Ops Console's enrichment of tester rows via getContact.
  saveContact('T5', {
    contactPerson: 'Neha',
    whatsappNumber: '+91 98765 43210',
    instagramUsername: '@neha.boutique',
    instagramAccountId: '17841400000000555',
    instagramStatus: 'CONNECTED',
    consent: { given: true, source: 'customer-self-service' },
  });

  const c = getContact('T5');
  const masked = c?.whatsappNumber ? maskPhone(c.whatsappNumber) : null;
  check('ops sees masked number (not raw)', masked === '+91•••••3210');
  check('ops sees contact person', c?.contactPerson === 'Neha');
  check('ops sees Instagram handle for matching', c?.instagramUsername === '@neha.boutique');
  check('ops sees Instagram account ID', c?.instagramAccountId === '17841400000000555');
  check('ops sees connection status', c?.instagramStatus === 'CONNECTED');
}

// ============================================================ TEST 8: Consent gating still works
{
  const dir = newDir('consent'); resetAll(dir);

  saveContact('T6', {
    contactPerson: 'Ravi',
    whatsappNumber: '+91 98765 43210',
    consent: { given: true, source: 'customer-self-service' },
  });
  check('consent gate yes', hasWhatsAppConsent('T6'));

  optOut('T6', 'customer-self-service');
  check('consent gate no after opt-out', !hasWhatsAppConsent('T6'));
}

// ============================================================ SUMMARY
rmSync(root, { recursive: true, force: true });
console.log(`\n${fail === 0 ? 'ALL TESTS PASSED' : 'FAILURES'}`);
console.log(`passed=${pass} failed=${fail}`);
if (failures.length) console.log('Failed checks:', failures.join(' | '));
process.exit(fail === 0 ? 0 : 1);
