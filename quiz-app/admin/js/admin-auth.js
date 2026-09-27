/**
 * Admin login gate. Only the single hardcoded ADMIN_UID may enter the
 * dashboard — anyone else who somehow authenticates is signed out again.
 */

function initAdminAuth(onReady) {
  const loginScreen = document.getElementById("login-screen");
  const appShell = document.getElementById("app-shell");
  const loginForm = document.getElementById("login-form");
  const loginError = document.getElementById("login-error");
  const loginBtn = document.getElementById("login-btn");
  const logoutBtn = document.getElementById("logout-btn");

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.textContent = "";
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<span class="spinner"></span> Signing in…';
    try {
      await adminAuth.signInWithEmailAndPassword(email, password);
      // onAuthStateChanged below handles the rest.
    } catch (err) {
      loginError.textContent = translateError(err);
      loginBtn.disabled = false;
      loginBtn.textContent = "Log in";
    }
  });

  logoutBtn.addEventListener("click", async () => {
    try {
      await adminAuth.signOut();
    } catch (err) {
      showErrorToast(err);
    }
  });

  adminAuth.onAuthStateChanged((user) => {
    loginBtn.disabled = false;
    loginBtn.textContent = "Log in";

    if (!user) {
      loginScreen.style.display = "flex";
      appShell.style.display = "none";
      return;
    }

    if (user.uid !== ADMIN_UID) {
      // Safety net: this login isn't the admin account. Never let it in.
      loginError.textContent = "This account isn't set up as the teacher/admin account.";
      adminAuth.signOut();
      return;
    }

    loginScreen.style.display = "none";
    appShell.style.display = "flex";
    onReady(user);
  });
}
