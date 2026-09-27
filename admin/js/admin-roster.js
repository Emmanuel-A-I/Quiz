/**
 * Roster management (max 10 students).
 *
 * Each student's current login password is also stored on their Firestore
 * roster document (`currentPassword`, admin/self-readable only per the
 * Security Rules). This is a deliberate trade-off documented in the setup
 * guide: with no backend/Admin SDK available on the Spark plan, the only
 * way to change or fully delete another user's Firebase Auth account from
 * the browser is to sign in AS them first — which requires knowing their
 * current password. Storing it is what lets the "Change password" and
 * "Delete student" actions work with one click, exactly as requested,
 * without an email-based reset flow. It is never exposed to other students.
 */
window.AdminState = window.AdminState || {};
AdminState.students = [];

const MAX_STUDENTS = 10;

function initRoster() {
  document.getElementById("btn-add-student").addEventListener("click", openAddStudentModal);

  adminDb.collection("students").onSnapshot(
    (snap) => {
      AdminState.students = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      AdminState.students.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      renderRosterList();
      document.dispatchEvent(new CustomEvent("admin:students-updated"));
    },
    (err) => {
      console.error("[roster listener]", err);
      showErrorToast(err);
      document.getElementById("roster-list").innerHTML = `<p class="empty-hint">Couldn't load the roster.</p>`;
    }
  );
}

function renderRosterList() {
  const el = document.getElementById("roster-list");
  document.getElementById("roster-count-label").textContent = `(${AdminState.students.length} / ${MAX_STUDENTS})`;
  document.getElementById("btn-add-student").disabled = AdminState.students.length >= MAX_STUDENTS;

  if (AdminState.students.length === 0) {
    el.innerHTML = `<p class="empty-hint">No students added yet.</p>`;
    return;
  }
  el.innerHTML = AdminState.students
    .map(
      (s) => `
      <div class="card student-card">
        ${avatarImgHtml(s, 76)}
        <div class="student-card-name">${escapeHtml(s.name)}</div>
        <div class="student-card-email">${escapeHtml(s.email)}</div>
        <div class="student-card-actions">
          <button class="btn btn-secondary btn-sm" data-edit="${s.id}">Edit</button>
          <button class="btn btn-secondary btn-sm" data-pw="${s.id}">Change password</button>
          <button class="btn btn-ghost btn-sm" data-del="${s.id}">Delete</button>
        </div>
      </div>`
    )
    .join("");

  el.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openEditStudentModal(AdminState.students.find((s) => s.id === btn.dataset.edit)))
  );
  el.querySelectorAll("[data-pw]").forEach((btn) =>
    btn.addEventListener("click", () => openChangePasswordModal(AdminState.students.find((s) => s.id === btn.dataset.pw)))
  );
  el.querySelectorAll("[data-del]").forEach((btn) =>
    btn.addEventListener("click", () => deleteStudent(AdminState.students.find((s) => s.id === btn.dataset.del)))
  );
}

function _avatarPickerHtml(selected) {
  return AVATAR_TYPES.map(
    (t) => `<button type="button" class="avatar-option ${t === selected ? "selected" : ""}" data-avatar-type="${t}">
      <img src="${defaultAvatarDataUri(t)}" alt="${t} icon" width="48" height="48"></button>`
  ).join("");
}

function _wireAvatarPicker(modal, initialType) {
  let selected = initialType || "neutral";
  modal.querySelectorAll(".avatar-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      selected = btn.dataset.avatarType;
      modal.querySelectorAll(".avatar-option").forEach((b) => b.classList.toggle("selected", b === btn));
    });
  });
  return () => selected;
}

// ------------------------------------------------------------- Add student

function openAddStudentModal() {
  if (AdminState.students.length >= MAX_STUDENTS) {
    showToast(`The roster is limited to ${MAX_STUDENTS} students.`, "error");
    return;
  }
  openModal(
    `
    <h3>Add student</h3>
    <form id="student-form">
      <div class="field"><label for="s-name">Full name</label><input type="text" id="s-name" required></div>
      <div class="field"><label for="s-email">Email</label><input type="email" id="s-email" required autocomplete="off"></div>
      <div class="field">
        <label for="s-password">Password</label>
        <input type="text" id="s-password" required minlength="6">
        <p class="hint">At least 6 characters. Write this down — you'll hand it to the student, and can change it any time here.</p>
      </div>
      <div class="field">
        <label>Default icon</label>
        <div class="avatar-picker">${_avatarPickerHtml("neutral")}</div>
      </div>
      <div class="field">
        <label for="s-photo">Photo (optional)</label>
        <input type="file" id="s-photo" accept="image/*">
      </div>
      <p id="s-error" class="form-error" role="alert"></p>
      <div style="display:flex; gap:10px; margin-top:12px;">
        <button type="button" class="btn btn-secondary" id="cancel-btn">Cancel</button>
        <button type="submit" class="btn btn-primary" id="submit-btn">Add student</button>
      </div>
    </form>
  `,
    (modal) => {
      const getAvatarType = _wireAvatarPicker(modal, "neutral");
      modal.querySelector("#cancel-btn").addEventListener("click", closeModal);
      modal.querySelector("#student-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const errEl = modal.querySelector("#s-error");
        const submitBtn = modal.querySelector("#submit-btn");
        errEl.textContent = "";
        const name = modal.querySelector("#s-name").value.trim();
        const email = modal.querySelector("#s-email").value.trim();
        const password = modal.querySelector("#s-password").value;
        const fileInput = modal.querySelector("#s-photo");

        if (password.length < 6) { errEl.textContent = "Password must be at least 6 characters."; return; }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner"></span> Creating…';
        try {
          let photoBase64 = null;
          if (fileInput.files[0]) {
            photoBase64 = await compressImageToDataUri(fileInput.files[0]);
          }

          // Create the Auth account on an isolated, in-memory-only secondary
          // app instance so the admin's own login session is never touched.
          const uid = await withEphemeralAuth(async (ephemeralAuth) => {
            const cred = await ephemeralAuth.createUserWithEmailAndPassword(email, password);
            return cred.user.uid;
          });

          await adminDb.collection("students").doc(uid).set({
            name, email,
            avatarType: getAvatarType(),
            photoBase64: photoBase64,
            currentPassword: password,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdBy: ADMIN_UID,
          });

          closeModal();
          showToast(`${name} was added to the roster.`, "success");
        } catch (err) {
          errEl.textContent = translateError(err);
          submitBtn.disabled = false;
          submitBtn.textContent = "Add student";
        }
      });
    }
  );
}

// ------------------------------------------------------------ Edit student

function openEditStudentModal(student) {
  openModal(
    `
    <h3>Edit student</h3>
    <form id="student-form">
      <div class="field"><label for="s-name">Full name</label><input type="text" id="s-name" required value="${escapeHtml(student.name)}"></div>
      <div class="field"><label>Email</label><input type="text" value="${escapeHtml(student.email)}" disabled></div>
      <div class="field">
        <label>Icon</label>
        <div class="avatar-picker">${_avatarPickerHtml(student.avatarType)}</div>
      </div>
      <div class="field">
        <label for="s-photo">Replace photo</label>
        <input type="file" id="s-photo" accept="image/*">
        ${student.photoBase64 ? `<button type="button" id="remove-photo-btn" class="btn btn-ghost btn-sm" style="margin-top:8px;">Remove current photo, use icon instead</button>` : ""}
      </div>
      <p id="s-error" class="form-error" role="alert"></p>
      <div style="display:flex; gap:10px; margin-top:12px;">
        <button type="button" class="btn btn-secondary" id="cancel-btn">Cancel</button>
        <button type="submit" class="btn btn-primary" id="submit-btn">Save changes</button>
      </div>
    </form>
  `,
    (modal) => {
      const getAvatarType = _wireAvatarPicker(modal, student.avatarType);
      let removePhoto = false;
      const removeBtn = modal.querySelector("#remove-photo-btn");
      if (removeBtn) {
        removeBtn.addEventListener("click", () => {
          removePhoto = true;
          showToast("Photo will be removed when you save.", "info", 2500);
        });
      }
      modal.querySelector("#cancel-btn").addEventListener("click", closeModal);
      modal.querySelector("#student-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const errEl = modal.querySelector("#s-error");
        const submitBtn = modal.querySelector("#submit-btn");
        errEl.textContent = "";
        const name = modal.querySelector("#s-name").value.trim();
        const fileInput = modal.querySelector("#s-photo");
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner"></span> Saving…';
        try {
          const update = {
            name, avatarType: getAvatarType(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          };
          if (fileInput.files[0]) {
            update.photoBase64 = await compressImageToDataUri(fileInput.files[0]);
          } else if (removePhoto) {
            update.photoBase64 = null;
          }
          await adminDb.collection("students").doc(student.id).update(update);
          closeModal();
          showToast("Student updated.", "success");
        } catch (err) {
          errEl.textContent = translateError(err);
          submitBtn.disabled = false;
          submitBtn.textContent = "Save changes";
        }
      });
    }
  );
}

// --------------------------------------------------------- Change password

function openChangePasswordModal(student) {
  openModal(
    `
    <h3>Change password for ${escapeHtml(student.name)}</h3>
    <form id="pw-form">
      <div class="field">
        <label for="new-password">New password</label>
        <input type="text" id="new-password" required minlength="6">
        <p class="hint">At least 6 characters. This takes effect immediately — write it down for the student.</p>
      </div>
      <p id="pw-error" class="form-error" role="alert"></p>
      <div style="display:flex; gap:10px; margin-top:12px;">
        <button type="button" class="btn btn-secondary" id="cancel-btn">Cancel</button>
        <button type="submit" class="btn btn-primary" id="submit-btn">Change password</button>
      </div>
    </form>
  `,
    (modal) => {
      modal.querySelector("#cancel-btn").addEventListener("click", closeModal);
      modal.querySelector("#pw-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const errEl = modal.querySelector("#pw-error");
        const submitBtn = modal.querySelector("#submit-btn");
        errEl.textContent = "";
        const newPassword = modal.querySelector("#new-password").value;
        if (newPassword.length < 6) { errEl.textContent = "Password must be at least 6 characters."; return; }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner"></span> Updating…';
        try {
          await withEphemeralAuth(async (ephemeralAuth) => {
            await ephemeralAuth.signInWithEmailAndPassword(student.email, student.currentPassword);
            await ephemeralAuth.currentUser.updatePassword(newPassword);
          });
          await adminDb.collection("students").doc(student.id).update({
            currentPassword: newPassword,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
          closeModal();
          showToast(`Password changed for ${student.name}.`, "success");
        } catch (err) {
          errEl.textContent = translateError(err);
          submitBtn.disabled = false;
          submitBtn.textContent = "Change password";
        }
      });
    }
  );
}

// -------------------------------------------------------------- Delete

async function deleteStudent(student) {
  let blocking = false;
  try {
    const snap = await adminDb.collection("sessions").where("studentIds", "array-contains", student.id).get();
    blocking = snap.docs.some((d) => ["live", "paused"].includes(d.data().status));
  } catch (err) { showErrorToast(err); return; }

  if (blocking) {
    showToast(`${student.name} is currently in a live or paused session. End it before deleting this student.`, "error", 6000);
    return;
  }

  openModal(
    `
    <h3>Delete ${escapeHtml(student.name)}?</h3>
    <p>This permanently deletes their login and roster record. Their results in past (ended) sessions are kept for your history and exports.</p>
    <p id="del-error" class="form-error" role="alert"></p>
    <div style="display:flex; gap:10px; margin-top:20px;">
      <button type="button" class="btn btn-secondary" id="cancel-btn">Cancel</button>
      <button type="button" class="btn btn-danger" id="confirm-btn">Delete student</button>
    </div>
  `,
    (modal) => {
      modal.querySelector("#cancel-btn").addEventListener("click", closeModal);
      modal.querySelector("#confirm-btn").addEventListener("click", async () => {
        const errEl = modal.querySelector("#del-error");
        try {
          await withEphemeralAuth(async (ephemeralAuth) => {
            await ephemeralAuth.signInWithEmailAndPassword(student.email, student.currentPassword);
            await ephemeralAuth.currentUser.delete();
          });
          await adminDb.collection("students").doc(student.id).delete();
          closeModal();
          showToast(`${student.name} was deleted.`, "success");
        } catch (err) {
          errEl.textContent = translateError(err);
        }
      });
    }
  );
}
