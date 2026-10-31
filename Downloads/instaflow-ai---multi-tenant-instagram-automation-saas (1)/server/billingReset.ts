/**
 * Which billing rows an owner-initiated reset may touch — and the confirmation it
 * has to carry before it is allowed to run.
 *
 * Why this is a module rather than a few lines inside the route: these are the
 * rules that decide whether a **paying** customer's row can be cleared by
 * accident, and a rule that only exists inside an HTTP handler can only ever be
 * exercised by a signed-in owner. Here it takes plain arguments, so the dangerous
 * cases — the owner's own account, an id that has no row at all, a count typed
 * from a tab that was open through the next signup — are decided by one function
 * a check can call directly.
 */

export type BillingResetSkipReason = 'owner-account' | 'no-billing-row' | 'unknown-tenant';

export interface BillingResetSkipped {
  tenantId: string;
  reason: BillingResetSkipReason;
}

export interface BillingResetPlan {
  /** Tenant ids whose billing row will be cleared, in the order they were asked. */
  candidates: string[];
  skipped: BillingResetSkipped[];
}

/**
 * Split what the owner asked for into what may be reset and what may not.
 *
 * An empty `requested` means "every billing row on this server" — the fleet-wide
 * form, where the owner's own accounts are filtered *here* rather than trusted to
 * the caller: they are never billed, so they have nothing to clear, and reporting
 * them as reset would claim a change that did not happen.
 *
 * Hidden accounts are deliberately **not** excluded. Hiding is what took an
 * account off the console's table, not off the billing gate: a hidden account
 * whose trial ran out is still blocked, so it still needs this.
 */
export function planBillingReset(input: {
  /** Tenant ids the caller named; empty = every billing row. */
  requested: string[];
  /** Every tenant id that currently has a billing row. */
  billingTenantIds: Iterable<string>;
  /** Accounts that are never billed (owner tenants), so never candidates. */
  ownerTenantIds: Iterable<string>;
  /** Ids that exist in the console's table, used only to explain a skip. */
  knownTenantIds: Iterable<string>;
}): BillingResetPlan {
  const billing = new Set(input.billingTenantIds);
  const owners = new Set(input.ownerTenantIds);
  const known = new Set(input.knownTenantIds);

  const candidates: string[] = [];
  const skipped: BillingResetSkipped[] = [];

  input.requested.forEach((tenantId) => {
    if (owners.has(tenantId)) {
      skipped.push({ tenantId, reason: 'owner-account' });
      return;
    }
    if (!billing.has(tenantId)) {
      // Two different dead ends, and the owner's next move depends on which: an
      // account with no billing row is already unblocked, an id nobody has ever
      // seen is a typo or a deleted account.
      skipped.push({ tenantId, reason: known.has(tenantId) ? 'no-billing-row' : 'unknown-tenant' });
      return;
    }
    candidates.push(tenantId);
  });

  return { candidates, skipped };
}

/**
 * The value the owner has to type for the fleet-wide reset.
 *
 * It is the server's own count of the rows it is about to clear, so a count read
 * from a tab opened before the last signup stops matching and the reset is
 * refused with the fresh number — the same reason a delete asks for the handle
 * rather than a checkbox.
 */
export function billingResetConfirmMatches(candidateCount: number, typed: unknown): boolean {
  return typeof typed === 'string' && typed.trim() === String(candidateCount);
}
