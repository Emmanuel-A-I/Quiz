/**
 * Admin view Firebase bootstrap.
 * [LESSON 2] Uses its OWN separately-named Firebase App instance ("admin")
 * so its login session cannot collide with the student or display views'
 * sessions when multiple tabs of this site are open on the same domain.
 */
const adminApp = firebase.initializeApp(FIREBASE_CONFIG, "admin");
const adminAuth = adminApp.auth();
const adminDb = adminApp.firestore();

// Persist the admin's login normally across page reloads/tabs of THIS view.
adminAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((e) => console.error(e));

/**
 * Runs `work(ephemeralAuth)` against a brand-new, uniquely-named Firebase
 * App instance whose Auth persistence is in-memory ONLY (never touching
 * shared browser storage). Used to sign in briefly "as" a student (to
 * change their password or delete their account) without ever disturbing
 * the admin's own logged-in session on `adminAuth`. Always tears the
 * temporary app down afterward, even on error.
 */
async function withEphemeralAuth(work) {
  const name = "ephemeral-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
  const ephemeralApp = firebase.initializeApp(FIREBASE_CONFIG, name);
  const ephemeralAuth = ephemeralApp.auth();
  try {
    await ephemeralAuth.setPersistence(firebase.auth.Auth.Persistence.NONE);
    return await work(ephemeralAuth);
  } finally {
    try { await ephemeralAuth.signOut(); } catch (e) { /* ignore */ }
    try { await ephemeralApp.delete(); } catch (e) { /* ignore */ }
  }
}
