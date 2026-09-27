/**
 * Student login. Any authenticated non-admin user is treated as a student;
 * their profile is read from students/{uid} (created by the teacher).
 */
function initStudentAuth(onReady) {
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
    loginBtn.innerHTML = '<span class="spinner"></span> Logging in…';
    try {
      await studentAuth.signInWithEmailAndPassword(email, password);
    } catch (err) {
      loginError.textContent = translateError(err);
      loginBtn.disabled = false;
      loginBtn.textContent = "Log in";
    }
  });

  logoutBtn.addEventListener("click", async () => {
    try { await studentAuth.signOut(); } catch (err) { showErrorToast(err); }
  });

  studentAuth.onAuthStateChanged(async (user) => {
    loginBtn.disabled = false;
    loginBtn.textContent = "Log in";

    if (!user) {
      loginScreen.style.display = "flex";
      appShell.style.display = "none";
      return;
    }
    if (user.uid === ADMIN_UID) {
      loginError.textContent = "This is the teacher account — please use the admin dashboard instead.";
      studentAuth.signOut();
      return;
    }

    try {
      const doc = await studentDb.collection("students").doc(user.uid).get();
      if (!doc.exists) {
        loginError.textContent = "We couldn't find your student profile. Ask your teacher to check your account.";
        studentAuth.signOut();
        return;
      }
      loginScreen.style.display = "none";
      appShell.style.display = "flex";
      onReady(user, { id: doc.id, ...doc.data() });
    } catch (err) {
      showErrorToast(err);
    }
  });
}
