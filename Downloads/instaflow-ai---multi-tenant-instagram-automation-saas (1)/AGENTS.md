# Agent notes — InstaFlow AI

Project root: `instaflow-ai---multi-tenant-instagram-automation-saas (1)`

## Bhasha / communication

- Is project ke owner se **Hinglish** (Roman-script Hindi) me baat karo — technical terms
  (route name, env var, file path, error text) English me hi rakho, unka translation nahi.
- Jawab chhota rakho, aur jo verify nahi hua ho use "verify nahi hua" bol ke alag likho.

## IDs aur accounts

Saare platform IDs (Meta app ids, Firebase project, owner accounts, domain, tenant ids) ki
ek hi jagah: `FGT-IDs.html` — section 6 "Accounts & tenant IDs". Naya account/ID banane par
wahi row update karo. Secrets us file me nahi jaate.

Important: `firebase-applet-config.json` ka `projectId` wahi hai jiske against server token
verify karta hai (`server/auth.ts`). Ise badalna = har customer ka tenant id orphan.
