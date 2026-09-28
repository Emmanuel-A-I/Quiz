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
        const questions = sortByCreated(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
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
        <span class="page-header-sub">${subject.type === "spelling" ? "Spelling Bee — you only enter the words; students never see them" : "General — answers are matched by key words, so different wording still passes"}</span>
      </h3>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-secondary btn-sm" id="btn-edit-subject">Edit subject</button>
        <button class="btn btn-ghost btn-sm" id="btn-delete-subject">Delete subject</button>
      </div>
    </div>
    <button class="btn btn-primary btn-sm" id="btn-add-question" style="margin-bottom:16px;">${subject.type === "spelling" ? "+ Add word" : "+ Add question"}</button>
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
  const isSpelling = subject && subject.type === "spelling";
  list.innerHTML = questions
    .map(
      (q, i) => `
      <div class="question-item">
        <div class="question-item-top">
          <div>
            ${isSpelling
          ? `<div class="question-text">Word ${i + 1}: ${escapeHtml(q.acceptedAnswers[0] || "")}</div>`
          : q.answerType === "mcq"
            ? `<div class="question-text">${i + 1}. ${escapeHtml(q.text)} <span class="badge badge-ready">Multiple choice</span></div>
                 <div class="question-answers">${(q.options || []).map((o) => o === q.acceptedAnswers[0] ? `<strong>✓ ${escapeHtml(o)}</strong>` : escapeHtml(o)).join(" &nbsp;·&nbsp; ")}</div>`
            : `<div class="question-text">${i + 1}. ${escapeHtml(q.text)}</div>
                 <div class="question-answers">Accepted: ${q.acceptedAnswers.map(escapeHtml).join(", ")}</div>`}
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
        <input type="text" id="subject-name" required placeholder="e.g. Math, English, Spelling Bee">
        <p class="hint">Only a subject named exactly "Spelling Bee" works as a spoken spelling test (you enter just the words; students never see them). Any other name is a normal question-and-answer subject.</p>
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
        if (!name) return;
        const type = isSpellingBeeName(name) ? "spelling" : "general";
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
        <p class="hint">Only the exact name "Spelling Bee" makes a spoken spelling subject. If you rename a subject that already has questions, delete and re-add them so they match the new type.</p>
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
        if (!name) return;
        const type = isSpellingBeeName(name) ? "spelling" : "general";
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
  const isSpelling = subject.type === "spelling";
  const answerType = isEdit ? (existingQuestion.answerType || "typed") : "typed";
  const opts = isEdit && existingQuestion.options ? existingQuestion.options : ["", "", "", ""];
  const correctIdx = isEdit && existingQuestion.answerType === "mcq"
    ? opts.findIndex((o) => o === existingQuestion.acceptedAnswers[0]) : 0;

  const fields = isSpelling
    ? `
      <div class="field">
        <label for="q-answers">Word (the correct spelling)</label>
        <input type="text" id="q-answers" required autocomplete="off"
          value="${isEdit ? escapeHtml(existingQuestion.acceptedAnswers[0] || "") : ""}"
          placeholder="e.g. necessary">
        <p class="hint">You'll say this word out loud. Students won't see it — they only get an answer box, and their spelling is checked against what you type here (exact match, not case-sensitive).</p>
      </div>`
    : `
      <div class="field">
        <label for="q-text">Question text</label>
        <textarea id="q-text" rows="2" required>${isEdit ? escapeHtml(existingQuestion.text) : ""}</textarea>
      </div>
      <div class="field">
        <label>Answer type</label>
        <div class="checklist" style="grid-template-columns:1fr 1fr;">
          <label><input type="radio" name="answer-type" value="typed" ${answerType === "typed" ? "checked" : ""}> Typed answer</label>
          <label><input type="radio" name="answer-type" value="mcq" ${answerType === "mcq" ? "checked" : ""}> Multiple choice</label>
        </div>
      </div>
      <div id="typed-fields" style="${answerType === "mcq" ? "display:none;" : ""}">
        <div class="field">
          <label for="q-answers">Accepted answers</label>
          <input type="text" id="q-answers"
            value="${isEdit && answerType !== "mcq" ? escapeHtml(existingQuestion.acceptedAnswers.join(", ")) : ""}"
            placeholder="e.g. Nigeria, Federal Republic of Nigeria">
          <p class="hint">Write the answer the way you'd like it explained. Students who word it differently still pass if they mean the same thing (typos, plurals, extra words and everyday synonyms are fine). You can add other accepted answers, separated by commas.</p>
        </div>
      </div>
      <div id="mcq-fields" style="${answerType === "mcq" ? "" : "display:none;"}">
        <div class="field">
          <label>Four options — mark the correct one</label>
          ${[0, 1, 2, 3].map((i) => `
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
              <input type="radio" name="mcq-correct" value="${i}" ${i === correctIdx ? "checked" : ""} aria-label="Option ${i + 1} is correct">
              <input type="text" class="mcq-option" data-idx="${i}" placeholder="Option ${i + 1}" value="${escapeHtml(opts[i] || "")}" style="flex:1; padding:12px 14px; background:var(--navy-950); border:1px solid var(--navy-line); border-radius:var(--radius-sm); color:var(--ink);">
            </div>`).join("")}
          <p class="hint">Students will see all four and pick one — no typing required for this question.</p>
        </div>
      </div>`;

  openModal(
    `
    <h3>${isEdit ? (isSpelling ? "Edit word" : "Edit question") : (isSpelling ? "Add word" : "Add question")}</h3>
    <form id="question-form">
      ${fields}
      <p id="q-error" class="form-error" role="alert"></p>
      <div style="display:flex; gap:10px; margin-top:12px;">
        <button type="button" class="btn btn-secondary" id="cancel-btn">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? "Save changes" : (isSpelling ? "Add word" : "Add question")}</button>
      </div>
    </form>
  `,
    (modal) => {
      modal.querySelector("#cancel-btn").addEventListener("click", closeModal);
      modal.querySelectorAll('input[name="answer-type"]').forEach((r) => {
        r.addEventListener("change", () => {
          const mcq = modal.querySelector('input[name="answer-type"]:checked').value === "mcq";
          modal.querySelector("#typed-fields").style.display = mcq ? "none" : "";
          modal.querySelector("#mcq-fields").style.display = mcq ? "" : "none";
        });
      });
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

  // ---- Spelling Bee: only the word is entered. No question text at all.
  if (subject.type === "spelling") {
    const word = modal.querySelector("#q-answers").value.trim();
    if (!word) { errEl.textContent = "Please type the word."; return; }
    if (word.includes(",")) { errEl.textContent = "Enter just ONE word (no commas)."; return; }
    await _saveQuestion(subject, existingQuestion, "", [word]);
    return;
  }

  // ---- General subjects
  const answerType = modal.querySelector('input[name="answer-type"]:checked').value;

  if (answerType === "mcq") {
    const optionInputs = Array.from(modal.querySelectorAll(".mcq-option"));
    const options = optionInputs.map((inp) => inp.value.trim());
    if (options.some((o) => !o)) { errEl.textContent = "Please fill in all 4 options."; return; }
    const unique = new Set(options.map((o) => o.toLowerCase()));
    if (unique.size !== 4) { errEl.textContent = "The 4 options must all be different."; return; }
    const correctRadio = modal.querySelector('input[name="mcq-correct"]:checked');
    if (!correctRadio) { errEl.textContent = "Please mark which option is correct."; return; }
    const text = modal.querySelector("#q-text").value.trim();
    if (!text) { errEl.textContent = "Please fill in the question."; return; }
    const correctOption = options[parseInt(correctRadio.value, 10)];
    await _saveQuestion(subject, existingQuestion, text, [correctOption], "mcq", options);
    return;
  }

  const text = modal.querySelector("#q-text").value.trim();
  const answers = parseAcceptedAnswers(modal.querySelector("#q-answers").value);
  if (!text || answers.length === 0) {
    errEl.textContent = "Please fill in the question and at least one accepted answer.";
    return;
  }

  if (!forceOverride && questionLeaksAnswer(text, answers)) {
    openModal(
      `
      <h3>⚠️ The question text contains the answer</h3>
      <p>The question as written already shows the accepted answer on screen.</p>
      <p><strong>Question:</strong> ${escapeHtml(text)}<br><strong>Accepted answer(s):</strong> ${answers.map(escapeHtml).join(", ")}</p>
      <div style="display:flex; gap:10px; margin-top:16px;">
        <button type="button" class="btn btn-secondary" id="back-btn">Go back and edit</button>
        <button type="button" class="btn btn-danger" id="override-btn">Save anyway</button>
      </div>
    `,
      (warnModal) => {
        warnModal.querySelector("#back-btn").addEventListener("click", () => openQuestionModal(subject, existingQuestion));
        warnModal.querySelector("#override-btn").addEventListener("click", () => {
          _saveQuestion(subject, existingQuestion, text, answers, "typed", null);
        });
      }
    );
    return;
  }

  await _saveQuestion(subject, existingQuestion, text, answers, "typed", null);
}

async function _saveQuestion(subject, existingQuestion, text, answers, answerType, options) {
  answerType = answerType || "typed";
  try {
    const col = adminDb.collection("subjects").doc(subject.id).collection("questions");
    const payload = { text, acceptedAnswers: answers, answerType, options: options || null };
    if (existingQuestion) {
      await col.doc(existingQuestion.id).update({
        ...payload, updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      showToast("Question updated.", "success");
    } else {
      await col.add({
        ...payload,
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
    <p>"${escapeHtml(question.text || (question.acceptedAnswers && question.acceptedAnswers[0]) || "")}" will be permanently removed from this subject.</p>
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