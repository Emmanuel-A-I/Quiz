/**
 * Display view Firebase bootstrap.
 * [LESSON 2] Its own separately-named Firebase App instance ("display"),
 * isolated from the admin and student views' login sessions. No person
 * logs into this view — it signs in anonymously so Security Rules
 * (which require isSignedIn()) can be satisfied without exposing anything
 * sensitive: the display only ever reads session metadata and the
 * secret-free participant/leaderboard fields.
 */
const displayApp = firebase.initializeApp(FIREBASE_CONFIG, "display");
const displayAuth = displayApp.auth();
const displayDb = displayApp.firestore();

displayAuth.setPersistence(firebase.auth.Auth.Persistence.NONE).catch((e) => console.error(e));

function ensureDisplaySignedIn(onReady) {
  displayAuth.onAuthStateChanged((user) => {
    if (user) { onReady(user); return; }
    displayAuth.signInAnonymously().catch((err) => {
      console.error("[display anonymous sign-in]", err);
      showErrorToast(err);
    });
  });
}
