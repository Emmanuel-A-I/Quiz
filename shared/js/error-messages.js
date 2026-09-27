/**
 * translateError(err)
 * Converts a raw Firebase Auth / Firestore error (or any thrown error) into a
 * calm, plain-English sentence safe to show a non-technical user.
 *
 * RULE: no code in this project should ever put `err.message` or `err.code`
 * directly in front of the user. Always route errors through this function.
 */
function translateError(err) {
  const code = (err && (err.code || err.name)) || "";
  const raw = (err && err.message) || String(err || "");

  const map = {
    "auth/invalid-email": "That email address doesn't look right. Please check it and try again.",
    "auth/user-not-found": "We couldn't find an account with those details.",
    "auth/wrong-password": "That password isn't correct. Please try again.",
    "auth/invalid-credential": "Those login details don't match our records. Please check and try again.",
    "auth/invalid-login-credentials": "Those login details don't match our records. Please check and try again.",
    "auth/too-many-requests": "Too many attempts. Please wait a minute and try again.",
    "auth/network-request-failed": "We couldn't reach the server. Please check your internet connection.",
    "auth/email-already-in-use": "That email is already being used by another account.",
    "auth/weak-password": "Please choose a password with at least 6 characters.",
    "auth/requires-recent-login": "For security, please log in again before doing that.",
    "auth/user-disabled": "This account has been disabled.",
    "auth/popup-closed-by-user": "The window was closed before finishing. Please try again.",
    "permission-denied": "You don't have permission to do that.",
    "unavailable": "The connection was interrupted. Please check your internet and try again.",
    "deadline-exceeded": "That took too long and timed out. Please try again.",
    "not-found": "That item couldn't be found — it may have been deleted.",
    "already-exists": "That already exists.",
    "resource-exhausted": "The app is temporarily busy. Please try again shortly.",
    "cancelled": "The action was cancelled.",
    "unauthenticated": "Please log in again to continue.",
  };

  for (const key in map) {
    if (code.toLowerCase().includes(key)) return map[key];
  }

  // Generic fallbacks by rough category, never exposing raw SDK text
  if (/network/i.test(raw)) return "We couldn't reach the server. Please check your internet connection.";
  if (/permission|insufficient/i.test(raw)) return "You don't have permission to do that.";

  return "Something went wrong. Please try again, and if it keeps happening, let your teacher/admin know.";
}

/** Show a small toast in a #toast-root element (created if missing). */
function showToast(message, type = "info", timeoutMs = 4500) {
  let root = document.getElementById("toast-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "toast-root";
    document.body.appendChild(root);
  }
  const el = document.createElement("div");
  el.className = "toast" + (type === "error" ? " error" : type === "success" ? " success" : "");
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity 0.3s ease";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, timeoutMs);
}

function showErrorToast(err) {
  console.error("[app error]", err);
  showToast(translateError(err), "error", 6000);
}
