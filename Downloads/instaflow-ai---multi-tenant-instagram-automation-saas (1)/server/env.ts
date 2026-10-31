import dotenv from 'dotenv';

// IMPORTANT: this module must stay the FIRST import in server.ts.
// It loads .env before any other server module runs its top-level code.
// Modules like aiService.ts / encryption.ts read process.env while they are
// being imported, and ES module imports are evaluated before the importing
// module's own body — so a later `dotenv.config()` call would be too late and
// the app would silently fall back to defaults.
dotenv.config();
