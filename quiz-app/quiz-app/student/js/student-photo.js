/**
 * Student profile modal — lets a student change their own photo/icon.
 * Security Rules restrict a student's self-update on students/{uid} to
 * only the photoBase64/avatarType/updatedAt fields.
 */
let _currentStudentRecord = null;

function initStudentProfile(studentRecord) {
  _currentStudentRecord = studentRecord;
  _refreshHeaderAvatar();
  document.getElementById("profile-btn").addEventListener("click", openProfileModal);
}

function updateLocalStudentRecord(patch) {
  _currentStudentRecord = { ..._currentStudentRecord, ...patch };
  _refreshHeaderAvatar();
}

function _refreshHeaderAvatar() {
  document.getElementById("profile-avatar").src = avatarSrc(_currentStudentRecord);
  document.getElementById("header-name").textContent = _currentStudentRecord.name;
}

function openProfileModal() {
  const s = _currentStudentRecord;
  openModal(
    `
    <h3>Your profile</h3>
    <div style="text-align:center; margin-bottom:16px;">
      <img src="${avatarSrc(s)}" alt="Your avatar" style="width:96px;height:96px;border-radius:50%;object-fit:cover;border:3px solid var(--orange-500);">
    </div>
    <div class="field">
      <label for="p-photo">Upload a new photo</label>
      <input type="file" id="p-photo" accept="image/*">
    </div>
    <div class="field">
      <label>Or use a default icon</label>
      <div class="avatar-picker" id="p-avatar-picker">
        ${AVATAR_TYPES.map((t) => `<button type="button" class="avatar-option ${t === s.avatarType ? "selected" : ""}" data-avatar-type="${t}"><img src="${defaultAvatarDataUri(t)}" width="48" height="48" alt="${t}"></button>`).join("")}
      </div>
    </div>
    <p id="p-error" class="form-error" role="alert"></p>
    <div style="display:flex; gap:10px; margin-top:12px;">
      <button type="button" class="btn btn-secondary" id="cancel-btn">Close</button>
      <button type="button" class="btn btn-primary" id="save-btn">Save</button>
    </div>
  `,
    (modal) => {
      modal.querySelectorAll(".avatar-option").forEach((btn) => {
        btn.addEventListener("click", () => {
          modal.querySelectorAll(".avatar-option").forEach((b) => b.classList.toggle("selected", b === btn));
        });
      });
      modal.querySelector("#cancel-btn").addEventListener("click", closeModal);
      modal.querySelector("#save-btn").addEventListener("click", async () => {
        const errEl = modal.querySelector("#p-error");
        const saveBtn = modal.querySelector("#save-btn");
        errEl.textContent = "";
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="spinner"></span> Saving…';
        try {
          const fileInput = modal.querySelector("#p-photo");
          const selectedBtn = modal.querySelector(".avatar-option.selected");
          const update = { updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
          if (fileInput.files[0]) {
            update.photoBase64 = await compressImageToDataUri(fileInput.files[0]);
          }
          if (selectedBtn) update.avatarType = selectedBtn.dataset.avatarType;
          await studentDb.collection("students").doc(s.id).update(update);
          updateLocalStudentRecord(update);
          closeModal();
          showToast("Profile updated.", "success");
        } catch (err) {
          errEl.textContent = translateError(err);
          saveBtn.disabled = false;
          saveBtn.textContent = "Save";
        }
      });
    }
  );
}
