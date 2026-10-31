/**
 * Best-guess Instagram username for the tester form.
 *
 * This exists because of one specific dead end: when Meta's access gate rejects
 * the connect, it does so *before* account discovery, so the server never learns
 * the handle and the dashboard has nothing to pre-fill. The customer would have
 * to type it — which is exactly the step we want to remove.
 *
 * So we guess from what is actually on hand, in priority order:
 *   1. a handle already connected to this tenant (they clearly use it),
 *   2. the local part of the signed-in email (usually the business handle),
 *      which is why a raw `user@mail.com` is accepted here, not just a handle,
 *   3. the Firebase display name.
 *
 * The guess is only ever a default in an editable box: the server runs the real
 * `normaliseInstagramUsername`/`isValidInstagramUsername` checks on submit, so a
 * wrong guess is a correction the customer makes, never a bad row.
 */
export function suggestInstagramUsername(...sources: Array<string | null | undefined>): string {
  const clean = (raw: string) => {
    // Gmail-style `name+tag@` aliases are almost never the Instagram handle, and
    // an email source only contributes its local part.
    let value = (raw || '').trim().split('+')[0];
    if (!value.startsWith('@')) value = value.split('@')[0] || value;
    return value
      // Accept a pasted profile URL, not just a bare handle.
      .replace(/^https?:\/\/(?:www\.)?instagram\.com\//i, '')
      .replace(/^@+/, '')
      .split(/[/?#]/)[0]
      .toLowerCase()
      .replace(/[^a-z0-9._]/g, '');
  };

  for (const source of sources) {
    const value = clean(source || '');
    if (value) return value;
  }
  return '';
}
