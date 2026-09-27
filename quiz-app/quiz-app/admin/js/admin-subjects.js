/**
 * Subjects + Questions management.
 * Exposes window.AdminState.subjects (array) kept in sync for other modules
 * (session creation needs to list subjects and their question counts).
 */
window.AdminState = window.AdminState || {};
AdminState.subjects = [];

let _selectedSubjectId = null;
let _questionsUnsub = null;

function initSubjects() {
  document.getElementById("btn-add-subject").addEventListener("click", openAddSubjectModal);

  adminDb.collection("subjects").onSnapshot(
    (snap) => {
      AdminState.subjects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      AdminState.subjects.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      renderSubjectsList();
      document.dispatchEvent(new CustomEvent("admin:subjects-updated"));
      // Keep the open detail pane's subject object fresh (e.g. name/type edits).
      if (_selectedSubjectId) renderQuestionsPanel();
    },
    (err) => {
      console.error("[subjects listener]", err);
      showErrorToast(err);
      document.getElementById("subjects-list").innerHTML =
        `<p class="empty-hint">Couldn't load subjects. ${escapeHtml(translateError(err))}</p>`;
    }
  );
}

function renderSubjectsList() {
  const el = document.getElementById("subjects-list");
  if (AdminState.subjects.length === 0) {
    el.innerHTML = `<p class="empty-hint">No subjects yet. Click "Add subject" to create one.</p>`;
    return;
  }
  el.innerHTML = AdminState.subjects
    .map(
      (s) => `
      <div class="subject-row ${s.id === _selectedSubjectId ? "active" : ""}" data-id="${s.id}">
        <div class="subject-row-main">
          <span class="subject-row-name">${escapeHtml(s.name)}</span>
          <span class="subject-row-meta">${s.type === "spelling" ? "Spelling Bee" : "General"} · ${s.questionCount || 0} question${(s.questionCount || 0) === 1 ? "" : "s"}</span>
        </div>
      </div>`
    )
    .join("");
  el.querySelectorAll(".subject-row").forEach((row) => {
    row.addEventListener("click", () => selectSubject(row.dataset.id));
  });
}

function selectSubject(subjectId) {
  _selectedSubjectId = subjectId;
  renderSubjectsList();
  if (_questionsUnsub) { _questionsUnsub(); _questionsUnsub = null; }

  _questionsUnsub = adminDb
    .collection("subjects").doc(subjectId).collection("questions")
    .onSnapshot(
      (snap) => {
        const questions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        questions.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
        _renderQuestionsList(questions);
        // keep the subject's cached question count in sync for the left list / session creation
        const subj = AdminState.subjects.find((s) => s.id === subjectId);
        if (subj) subj.questionCount = questions.length;
        renderSubjectsList();
      },
      (err) => {
        console.error("[questions listener]", err);
        showErrorToast(err);
      }
    );
  renderQuestionsPanel();
}

function renderQuestionsPanel() {
  const subject = AdminState.subjects.find((s) => s.id === _selectedSubjectId);
  const panel = document.getElementById("questions-panel");
  if (!subject) {
    panel.innerHTML = `<p class="empty-hint">Select a subject on the left to manage its questions.</p>`;
    return;
  }
  panel.innerHTML = `
    <div class="page-header">
      <h3 style="margin:0;">${escapeHtml(subject.name)}
        <span class="page-header-sub">${subject.type === "spelling" ? "Spelling Bee — one accepted answer per question" : "General — multiple accepted answers allowed"}</span>
      </h3>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-secondary btn-sm" id="btn-edit-subject">Edit subject</button>
        <button class="btn btn-ghost btn-sm" id="btn-delete-subject">Delete subject</button>
      </div>
    </div>
    <button class="btn btn-primary btn-sm" id="btn-add-question" style="margin-bottom:16px;">+ Add question</button>
    <div id="questions-list"></div>
  `;
  document.getElementById("btn-edit-subject").addEventListener("click", () => openEditSubjectModal(subject));
  document.getElementById("btn-delete-subject").addEventListener("click", () => deleteSubject(subject));
  document.getElementById("btn-add-question").addEventListener("click", () => openQuestionModal(subject, null));
}

function _renderQuestionsList(questions) {
  const list = document.getElementById("questions-list");
  if (!list) return;
  if (questions.length === 0) {
    list.innerHTML = `<p class="empty-hint">No questions yet.</p>`;
    return;
  }
  const subject = AdminState.subjects.find((s) => s.id === _selectedSubjectId);
  list.innerHTML = questions
    .map(
      (q, i) => `
      <div class="question-item">
        <div class="question-item-top">
          <div>
            <div class="question-text">${i + 1}. ${escapeHtml(q.text)}</div>
            <div class="question-answers">Accepted: ${q.acceptedAnswers.map(escapeHtml).join(", ")}</div>
          </div>
          <div class="question-actions">
            <button class="btn btn-secondary btn-sm" data-edit="${q.id}">Edit</button>
            <button class="btn btn-ghost btn-sm" data-del="${q.id}">Delete</button>
          </div>
        </div>
      </div>`
    )
    .join("");
  list.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openQuestionModal(subject, questions.find((q) => q.id === btn.dataset.edit)))
  );
  list.querySelectorAll("[data-del]").forEach((btn) =>
    btn.addEventListener("click", () => deleteQuestion(btn.dataset.del, questions.find((q) => q.id === btn.dataset.del)))
  );
}

// ---------------------------------------------------------------- Subjects

function openAddSubjectModal() {
  openModal(
    `
    <h3>Add subject</h3>
    <form id="subject-form">
      <div class="field">
        <label for="subject-name">Subject name</label>
        <input type="text" id="subject-name" required placeholder="e.g. Spelling Bee, Math, English">
      </div>
      <div class="field">
        <label>Question type</label>
        <div class="checklist" style="grid-template-columns:1fr;">
          <label><input type="radio" name="subject-type" value="general" checked> General — multiple accepted answers allowed per question</label>
          <label><input type="radio" name="subject-type" value="spelling"> Spelling Bee — exactly one accepted answer per question, exact match</label>
        </div>
      </div>
      <div style="display:flex; gap:10px; margin-top:20px;">
        <button type="button" class="btn btn-secondary" id="cancel-btn">Cancel</button>
        <button type="submit" class="btn btn-primary">Create subject</button>
      </div>
    </form>
  `,
    (modal) => {
      modal.querySelector("#cancel-btn").addEventListener("click", closeModal);
      modal.querySelector("#subject-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = modal.querySelector("#subject-name").value.trim();
        const type = modal.querySelector('input[name="subject-type"]:checked').value;
        if (!name) return;
        try {
          await adminDb.collection("subjects").add({
            name, type, questionCount: 0,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdBy: ADMIN_UID,
          });
          closeModal();
          showToast("Subject created.", "success");
        } catch (err) { showErrorToast(err); }
      });
    }
  );
}

function openEditSubjectModal(subject) {
  openModal(
    `
    <h3>Edit subject</h3>
    <form id="subject-form">
      <div class="field">
        <label for="subject-name">Subject name</label>
        <input type="text" id="subject-name" required value="${escapeHtml(subject.name)}">
      </div>
      <div class="field">
        <label>Question type</label>
        <div class="checklist" style="grid-template-columns:1fr;">
          <label><input type="radio" name="subject-type" value="general" ${subject.type !== "spelling" ? "checked" : ""}> General — multiple accepted answers</label>
          <label><input type="radio" name="subject-type" value="spelling" ${subject.type === "spelling" ? "checked" : ""}> Spelling Bee — one accepted answer</label>
        </div>
        <p class="hint">Changing this only affects how new/edited questions are validated — it won't re-check existing questions.</p>
      </div>
      <div style="display:flex; gap:10px; margin-top:20px;">
        <button type="button" class="btn btn-secondary" id="cancel-btn">Cancel</button>
        <button type="submit" class="btn btn-primary">Save changes</button>
      </div>
    </form>
  `,
    (modal) => {
      modal.querySelector("#cancel-btn").addEventListener("click", closeModal);
      modal.querySelector("#subject-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = modal.querySelector("#subject-name").value.trim();
        const type = modal.querySelector('input[name="subject-type"]:checked').value;
        if (!name) return;
        try {
          await adminDb.collection("subjects").doc(subject.id).update({
            name, type, updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
          closeModal();
          showToast("Subject updated.", "success");
        } catch (err) { showErrorToast(err); }
      });
    }
  );
}

async function deleteSubject(subject) {
  try {
    // [Product rule] Block deletion while any session on this subject is live/paused.
    const snap = await adminDb.collection("sessions").where("subjectId", "==", subject.id).get();
    const blocking = snap.docs.some((d) => ["live", "paused"].includes(d.data().status));
    if (blocking) {
      showToast("This subject can't be deleted while a session using it is live or paused. Pause and end it first.", "error", 6000);
      return;
    }
  } catch (err) { showErrorToast(err); return; }

  openModal(
    `
    <h3>Delete "${escapeHtml(subject.name)}"?</h3>
    <p>This permanently deletes the subject and all of its questions. Past sessions that already ran on this subject keep their own saved copy of the questions, so their history and exports are unaffected.</p>
    <div style="display:flex; gap:10px; margin-top:20px;">
      <button type="button" class="btn btn-secondary" id="cancel-btn">Cancel</button>
      <button type="button" class="btn btn-danger" id="confirm-btn">Delete subject</button>
    </div>
  `,
    (modal) => {
      modal.querySelector("#cancel-btn").addEventListener("click", closeModal);
      modal.querySelector("#confirm-btn").addEventListener("click", async () => {
        try {
          const qSnap = await adminDb.collection("subjects").doc(subject.id).collection("questions").get();
          const batch = adminDb.batch();
          qSnap.docs.forEach((d) => batch.delete(d.ref));
          batch.delete(adminDb.collection("subjects").doc(subject.id));
          await batch.commit();
          if (_selectedSubjectId === subject.id) {
            _selectedSubjectId = null;
            if (_questionsUnsub) { _questionsUnsub(); _questionsUnsub = null; }
            renderQuestionsPanel();
          }
          closeModal();
          showToast("Subject deleted.", "success");
        } catch (err) { showErrorToast(err); }
      });
    }
  );
}

// ---------------------------------------------------------------- Questions

function openQuestionModal(subject, existingQuestion) {
  const isEdit = !!existingQuestion;
  openModal(
    `
    <h3>${isEdit ? "Edit question" : "Add question"}</h3>
    <form id="question-form">
      <div class="field">
        <label for="q-text">Question text</label>
        <textarea id="q-text" rows="2" required>${isEdit ? escapeHtml(existingQuestion.text) : ""}</textarea>
      </div>
      <div class="field">
        <label for="q-answers">Accepted answer${subject.type === "spelling" ? "" : "s"}</label>
        <input type="text" id="q-answers" required
          value="${isEdit ? escapeHtml(existingQuestion.acceptedAnswers.join(", ")) : ""}"
          placeholder="${subject.type === "spelling" ? "e.g. necessary" : "e.g. Nigeria, Federal Republic of Nigeria"}">
        <p class="hint">${subject.type === "spelling" ? "Spelling Bee questions accept exactly one answer, matched exactly (case-insensitive)." : "Separate multiple accepted answers with commas. Matching is exact (case-insensitive), not fuzzy."}</p>
      </div>
      <p id="q-error" class="form-error" role="alert"></p>
      <div style="display:flex; gap:10px; margin-top:12px;">
        <button type="button" class="btn btn-secondary" id="cancel-btn">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? "Save changes" : "Add question"}</button>
      </div>
    </form>
  `,
    (modal) => {
      modal.querySelector("#cancel-btn").addEventListener("click", closeModal);
      modal.querySelector("#question-form").addEventListener("submit", (e) => {
        e.preventDefault();
        _handleQuestionSubmit(subject, existingQuestion, modal);
      });
    }
  );
}

async function _handleQuestionSubmit(subject, existingQuestion, modal, forceOverride) {
  const errEl = modal.querySelector("#q-error");
  errEl.textContent = "";
  const text = modal.querySelector("#q-text").value.trim();
  const answers = parseAcceptedAnswers(modal.querySelector("#q-answers").value);

  if (!text || answers.length === 0) {
    errEl.textContent = "Please fill in the question and at least one accepted answer.";
    return;
  }
  if (subject.type === "spelling" && answers.length > 1) {
    errEl.textContent = "Spelling Bee questions can only have ONE accepted answer. Please enter just the correct spelling.";
    return;
  }

  if (!forceOverride && questionLeaksAnswer(text, answers)) {
    openModal(
      `
      <h3>⚠️ The question text contains the answer</h3>
      <p>The question as written already shows the accepted answer on screen. For a spelling test, the word should be said aloud, not written — otherwise the test defeats its own purpose.</p>
      <p><strong>Question:</strong> ${escapeHtml(text)}<br><strong>Accepted answer(s):</strong> ${answers.map(escapeHtml).join(", ")}</p>
      <div style="display:flex; gap:10px; margin-top:16px;">
        <button type="button" class="btn btn-secondary" id="back-btn">Go back and edit</button>
        <button type="button" class="btn btn-danger" id="override-btn">Save anyway</button>
      </div>
    `,
      (warnModal) => {
        warnModal.querySelector("#back-btn").addEventListener("click", () => openQuestionModal(subject, existingQuestion));
        warnModal.querySelector("#override-btn").addEventListener("click", () => {
          _saveQuestion(subject, existingQuestion, text, answers);
        });
      }
    );
    return;
  }

  await _saveQuestion(subject, existingQuestion, text, answers);
}

async function _saveQuestion(subject, existingQuestion, text, answers) {
  try {
    const col = adminDb.collection("subjects").doc(subject.id).collection("questions");
    if (existingQuestion) {
      await col.doc(existingQuestion.id).update({
        text, acceptedAnswers: answers, updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      showToast("Question updated.", "success");
    } else {
      await col.add({
        text, acceptedAnswers: answers,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      // Persist the count on the subject doc itself (not just in the local
      // cache) so it's correct on a fresh page load, before this subject's
      // question panel has ever been opened this session.
      await adminDb.collection("subjects").doc(subject.id).update({
        questionCount: firebase.firestore.FieldValue.increment(1),
      });
      showToast("Question added.", "success");
    }
    closeModal();
  } catch (err) { showErrorToast(err); }
}

async function deleteQuestion(questionId, question) {
  openModal(
    `
    <h3>Delete this question?</h3>
    <p>"${escapeHtml(question.text)}" will be permanently removed from this subject.</p>
    <div style="display:flex; gap:10px; margin-top:20px;">
      <button type="button" class="btn btn-secondary" id="cancel-btn">Cancel</button>
      <button type="button" class="btn btn-danger" id="confirm-btn">Delete question</button>
    </div>
  `,
    (modal) => {
      modal.querySelector("#cancel-btn").addEventListener("click", closeModal);
      modal.querySelector("#confirm-btn").addEventListener("click", async () => {
        try {
          const subjectId = _selectedSubjectId;
          await adminDb.collection("subjects").doc(subjectId).collection("questions").doc(questionId).delete();
          await adminDb.collection("subjects").doc(subjectId).update({
            questionCount: firebase.firestore.FieldValue.increment(-1),
          });
          closeModal();
          showToast("Question deleted.", "success");
        } catch (err) { showErrorToast(err); }
      });
    }
  );
}
