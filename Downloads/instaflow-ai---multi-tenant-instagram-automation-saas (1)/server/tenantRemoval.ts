import { disconnectAccount, listConnections } from './connectionStore';
import { deleteChatsForTenant } from './chatStore';
import { deleteLeadsForTenant } from './leadStore';
import { deleteTenantAiSettings } from './tenantSettings';
import { deleteSubscriptionForTenant, findSubscription, getPlan } from './planStore';
import { deleteTesterRequest } from './testerRequestStore';
import { clearBotControl } from './botControlStore';
import { clearKbGaps } from './kbGapStore';
import { forgetUnroutedDeliveriesForAccount } from './deliveryAlertStore';
import {
  recordAccountRemoval,
  type RemovedAccountCounts,
  type RemovedAccountRecord,
} from './accountRemovalStore';

/**
 * Permanently erase everything this server holds for one tenant.
 *
 * Why one module instead of the route doing it: a delete is only correct if it is
 * *complete* and *ordered*. Every store keeps its own file, so a route that
 * forgets one — the billing row, the tester request, the open KB questions —
 * leaves an account that no longer exists to the customer but still shows up in
 * the owner's console as a live one. The same ordering trap runs the other way:
 * the connection has to be read *before* it is deleted, or the audit record
 * cannot say which handle was removed.
 *
 * Two deliberate rules:
 *   - the tombstone is written **last**, so a failure part-way through can never
 *     leave an account that still has data but is blocked from trialling;
 *   - it deletes records, not the customer's Instagram account. Nothing here can
 *     touch Meta — the account itself keeps working exactly as it is, it just has
 *     no bot behind it any more. The customer's own Firebase sign-in is likewise
 *     untouched: the server has no authority over it, and the tombstone is what
 *     stops that sign-in from claiming a fresh trial (`planStore.startTrial`).
 */

export interface TenantRemovalResult extends RemovedAccountRecord {
  /** Rows dropped from the console's "DM with no account" panel. */
  deliveryAlerts: number;
}

/**
 * What the owner has to type to confirm a delete: the handle they know the
 * account by, or the uid when it never got that far.
 *
 * A typed confirmation rather than a checkbox because it cannot be produced by a
 * mis-click, a stale tab, or a retried request — and because the uid is on the
 * row in front of them, so a wrong row means a value they cannot type.
 */
export function deleteConfirmValues(tenantId: string, instagramUsername?: string): string[] {
  const handle = String(instagramUsername || '').replace(/^@/, '').trim();
  return [handle, tenantId].filter(Boolean);
}

export function deleteConfirmMatches(
  tenantId: string,
  instagramUsername: string | undefined,
  typed: string
): boolean {
  const needle = String(typed || '').trim().replace(/^@/, '').toLowerCase();
  if (!needle) return false;
  return deleteConfirmValues(tenantId, instagramUsername).some(
    (value) => value.toLowerCase() === needle
  );
}

export function removeTenantCompletely(input: {
  tenantId: string;
  removedBy: string;
  note?: string;
}): TenantRemovalResult {
  const { tenantId } = input;

  // Snapshot first. After the purge there is no handle, no plan and no name left
  // to describe the account in the audit trail.
  const connection = listConnections().find((c) => c.tenantId === tenantId);
  const subscription = findSubscription(tenantId);
  const planName = subscription
    ? getPlan(subscription.planId)?.name || subscription.planId
    : undefined;

  const deleted: RemovedAccountCounts = {
    connection: disconnectAccount(tenantId),
    chats: deleteChatsForTenant(tenantId),
    leads: deleteLeadsForTenant(tenantId),
    aiSettings: deleteTenantAiSettings(tenantId),
    subscription: deleteSubscriptionForTenant(tenantId),
    testerRequest: deleteTesterRequest(tenantId),
    botControl: clearBotControl(tenantId),
    kbGaps: clearKbGaps(tenantId),
  };

  // An unrouted delivery is keyed by the Instagram account that received the DM,
  // which after a delete is an account nobody can reconnect.
  const deliveryAlerts = connection?.instagramAccountId
    ? forgetUnroutedDeliveriesForAccount(connection.instagramAccountId)
    : 0;

  const record = recordAccountRemoval({
    tenantId,
    removedBy: input.removedBy,
    note: input.note,
    instagramUsername: connection?.instagramUsername,
    planName,
    deleted,
  });

  return { ...record, deliveryAlerts };
}
