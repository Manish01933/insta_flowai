/**
 * Firebase surfaces terse codes like "Firebase: Error (auth/unauthorized-domain)."
 * Translate them into the exact console setting the operator needs to change, so a
 * failed sign-in ends in an action instead of a stack of jargon.
 *
 * Shared by the customer dashboard (App.tsx) and the owner Ops Console: the fix
 * for a rejected sign-in is identical in both, and the owner console is a
 * separate bundle that must not import App.tsx.
 */
export function describeAuthError(err: any): string {
  const code: string = err?.code || '';
  const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';

  switch (code) {
    case 'auth/unauthorized-domain':
      return `Firebase rejected "${host}". Add it under Firebase Console > Authentication > Settings > Authorized domains, then reload. Until then, Demo Mode below runs the platform without an account.`;
    case 'auth/operation-not-allowed':
      return 'This sign-in method is disabled for the Firebase project. Enable it under Firebase Console > Authentication > Sign-in method (Email/Password and/or Google).';
    case 'auth/configuration-not-found':
      return 'Firebase Authentication is not provisioned for this project. Open Firebase Console > Authentication and click "Get started".';
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid':
      return 'The Firebase API key in firebase-applet-config.json is invalid or restricted. Regenerate it under Firebase Console > Project settings > General.';
    case 'auth/popup-blocked':
      return 'The browser blocked the Google sign-in popup. Allow popups for this site, or use Email/Password sign-in instead.';
    case 'auth/popup-closed-by-user':
      return 'The sign-in popup was closed before finishing. Please try again.';
    case 'auth/network-request-failed':
      return 'Could not reach Firebase Auth. Check your connection, VPN or ad-blocker, then retry.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes before trying again.';
    case 'auth/internal-error':
      return 'Firebase Auth returned an internal error. Confirm Authentication is provisioned for the project, the API key is not restricted, and this domain is authorised. Demo Mode works without Firebase.';
    default:
      return err?.message || 'Authentication failed.';
  }
}
