/**
 * Firebase project configuration — shared values, project "shool-quiz".
 * Each view (admin/student/display) initializes its OWN separately-named
 * Firebase App instance using these same config values (see each view's
 * js/app-init.js). This prevents Firebase Auth's shared-by-origin session
 * storage from letting one view's login silently overwrite another view's
 * login when multiple tabs are open on the same domain.
 */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCvzKraJUTiIjxaWs9IemAmnL97NGqIg4M",
  authDomain: "shool-quiz.firebaseapp.com",
  projectId: "shool-quiz",
  storageBucket: "shool-quiz.firebasestorage.app",
  messagingSenderId: "334773536146",
  appId: "1:334773536146:web:c59988c2bafd1db18c6d4b",
};

/** The one hardcoded admin account UID. Must match the Security Rules file exactly. */
const ADMIN_UID = "mVvrEBE8BfRCiFUncoA0fo2B7i72";
