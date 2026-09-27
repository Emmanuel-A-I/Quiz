/**
 * Student quiz engine.
 *
 * [LESSON 1] The session-lookup query filters on a single field only
 * (studentIds array-contains uid) — status filtering happens client-side
 * in JS, never as a second where() clause, to avoid any silent
 * composite-index requirement.
 *
 * A student can only ever be part of one live/paused/ready session at a
 * time (enforced by the admin's session-creation picker), so this file
 * only ever has to track a single "relevant" session.
 */

let _uid = null;
let _session = null;
let _participant = null;
let _answers = {}; // questionId -> answer doc
let _drafts = {}; // questionId -> locally-typed, not-yet-submitted text
let _autoSubmitLock = new Set();
let _lastSeenResetToken = null;

let _sessionsQueryUnsub = null;
let _participantUnsub = null;
let _answersUnsub = null;

function initStudentQuiz(uid) {
  _uid = uid;
  setInterval(_tick, 1000);

  _sessionsQueryUnsub = studentDb.collection("sessions")
    .where("studentIds", "array-contains", uid)
    .onSnapshot(
      (snap) => {
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const relevant = all
          .filter((s) => ["ready", "live", "paused"].includes(s.status))
          .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))[0] || null;
        _switchSession(relevant);
      },
      (err) => {
        console.error("[student sessions listener]", err);
        showErrorToast(err);
        _showState("none");
      }
    );
}

function _switchSession(session) {
  if (session && _session && session.id === _session.id) {
    _session = session;
    _renderForCurrentState();
    return;
  }
  if (_participantUnsub) { _participantUnsub(); _participantUnsub = null; }
  if (_answersUnsub) { _answersUnsub(); _answersUnsub = null; }
  _session = session;
  _participant = null;
  _answers = {};
  _drafts = {};
  _lastSeenResetToken = null;

  if (!session) { _showState("none"); return; }
  _showState("loading");

  const participantRef = studentDb.collection("sessions").doc(session.id).collection("participants").doc(_uid);

  _participantUnsub = participantRef.onSnapshot(
    (doc) => {
      if (!doc.exists) return;
      const prev = _participant;
      _participant = { id: doc.id, ...doc.data() };
      if (_lastSeenResetToken === null) {
        _lastSeenResetToken = _participant.resetToken || 0;
      } else if ((_participant.resetToken || 0) !== _lastSeenResetToken) {
        _lastSeenResetToken = _participant.resetToken || 0;
        _autoSubmitCurrentIfNeeded();
      }
      _renderForCurrentState();
    },
    (err) => { console.error("[participant listener]", err); showErrorToast(err); }
  );

  _answersUnsub = participantRef.collection("answers").onSnapshot(
    (snap) => {
      _answers = {};
      snap.docs.forEach((d) => { _answers[d.id] = { id: d.id, ...d.data() }; });
      _renderForCurrentState();
    },
    (err) => { console.error("[answers listener]", err); showErrorToast(err); }
  );
}

function _showState(name) {
  ["loading", "none", "waiting", "paused", "quiz", "finished"].forEach((n) => {
    document.getElementById(`state-${n}`).style.display = n === name ? "" : "none";
  });
  document.getElementById("header-subject").textContent = _session ? _session.subjectName : "";
}

function _renderForCurrentState() {
  if (!_session) { _showState("none"); return; }
  if (!_participant || Object.keys(_answers).length === 0) { _showState("loading"); return; }

  if (_session.status === "ready") {
    document.getElementById("waiting-subject").textContent = _session.subjectName;
    _showState("waiting");
  } else if (_session.status === "paused") {
    _showState("paused");
  } else if (_session.status === "live") {
    _showState("quiz");
    _renderQuizQuestion();
  } else if (_session.status === "ended") {
    _showState("finished");
    _renderFinished();
  }
}

// -------------------------------------------------------------- Quiz view

function _renderQuizQuestion() {
  const order = _participant.order || [];
  const total = order.length;
  const idx = _participant.currentIndex || 0;
  const answeredCount = order.filter((qId) => _answers[qId] && _answers[qId].answered).length;

  document.getElementById("progress-fill").style.width = total > 0 ? `${Math.round((answeredCount / total) * 100)}%` : "0%";

  const cardWrap = document.querySelector(".question-card");

  if (idx >= total) {
    document.getElementById("progress-label").textContent = `All ${total} questions answered`;
    cardWrap.innerHTML = `
      <div class="question-card-text">🎉 You've answered every question.</div>
      <p class="hint">Waiting for the timer to end or your teacher to finish the session — your score will appear here.</p>
    `;
    document.getElementById("prev-btn").disabled = total === 0;
    document.getElementById("next-btn").disabled = true;
    _renderDots(order, idx);
    return;
  }

  document.getElementById("progress-label").textContent = `Question ${idx + 1} of ${total}`;

  const qId = order[idx];
  const answerDoc = _answers[qId];

  document.getElementById("prev-btn").disabled = idx === 0;
  document.getElementById("next-btn").disabled = idx >= total - 1;

  cardWrap.innerHTML = `
    <div class="question-card-text" id="question-text"></div>
    <div id="answer-form-wrap"></div>
  `;
  document.getElementById("question-text").textContent = answerDoc ? answerDoc.questionText : "…";

  const formWrap = document.getElementById("answer-form-wrap");

  if (answerDoc && answerDoc.answered) {
    formWrap.innerHTML = `
      <div class="result-badge ${answerDoc.isCorrect ? "correct" : "incorrect"}">${answerDoc.isCorrect ? "✓ Correct" : "✗ Incorrect"}</div>
      <p class="hint" style="margin-top:10px;">Your answer: <strong>${escapeHtml(answerDoc.studentAnswer || "(no answer)")}</strong></p>
    `;
  } else {
    formWrap.innerHTML = `
      <input type="text" id="answer-input" class="answer-input" placeholder="Type your answer…" autocomplete="off" maxlength="200" ${_session.status !== "live" ? "disabled" : ""}>
      <button id="submit-answer-btn" class="btn btn-primary btn-block" ${_session.status !== "live" ? "disabled" : ""}>Submit answer</button>
    `;
    const input = document.getElementById("answer-input");
    input.value = _drafts[qId] || "";
    input.addEventListener("input", () => { _drafts[qId] = input.value; });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); _handleManualSubmit(qId); } });
    document.getElementById("submit-answer-btn").addEventListener("click", () => _handleManualSubmit(qId));
  }

  _renderDots(order, idx);
}

function _renderDots(order, currentIdx) {
  const el = document.getElementById("question-dots");
  el.innerHTML = order
    .map((qId, i) => {
      const a = _answers[qId];
      let cls = "q-dot";
      if (a && a.answered) cls += a.isCorrect ? " answered-correct" : " answered-incorrect";
      if (i === currentIdx) cls += " current";
      return `<span class="${cls}" title="Question ${i + 1}"></span>`;
    })
    .join("");
}

async function _handleManualSubmit(qId) {
  const input = document.getElementById("answer-input");
  const btn = document.getElementById("submit-answer-btn");
  const text = input ? input.value : "";
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Submitting…'; }
  try {
    await _submitAnswer(qId, text, false);
    delete _drafts[qId];
    // Auto-advance to the next question, if there is one.
    const total = (_participant.order || []).length;
    if (_participant.currentIndex < total - 1) {
      await _writeCurrentIndex(_participant.currentIndex + 1);
    }
  } catch (err) {
    showErrorToast(err);
    if (btn) { btn.disabled = false; btn.textContent = "Submit answer"; }
  }
}

document.getElementById("prev-btn") && document.getElementById("prev-btn").addEventListener("click", () => {
  if (_participant && _participant.currentIndex > 0) _writeCurrentIndex(_participant.currentIndex - 1);
});
document.getElementById("next-btn") && document.getElementById("next-btn").addEventListener("click", () => {
  const total = (_participant && _participant.order || []).length;
  if (_participant && _participant.currentIndex < total - 1) _writeCurrentIndex(_participant.currentIndex + 1);
});

async function _writeCurrentIndex(newIndex) {
  try {
    await studentDb.collection("sessions").doc(_session.id).collection("participants").doc(_uid)
      .update({ currentIndex: newIndex, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
  } catch (err) { showErrorToast(err); }
}

/** Writes the answer (manual or auto). Also updates the participant's convenience score fields. */
async function _submitAnswer(qId, text, autoSubmitted) {
  const answerDoc = _answers[qId];
  if (!answerDoc || answerDoc.answered) return;
  const trimmed = (text || "").trim();
  const isCorrect = isAnswerCorrect(trimmed, answerDoc.acceptedAnswersLower);

  const answerRef = studentDb.collection("sessions").doc(_session.id).collection("participants").doc(_uid).collection("answers").doc(qId);
  await answerRef.update({
    answered: true,
    studentAnswer: trimmed,
    isCorrect,
    autoSubmitted: !!autoSubmitted,
    submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });

  // Best-effort convenience aggregate for the live leaderboard (see rules
  // file comment on why the official score is always recomputed by admin
  // from the answers subcollection, not from these fields).
  try {
    const total = _participant.totalQuestions || (_participant.order || []).length;
    const newCorrect = (_participant.correctCount || 0) + (isCorrect ? 1 : 0);
    const newAnswered = (_participant.answeredCount || 0) + 1;
    const pct = total > 0 ? Math.round((newCorrect / total) * 100) : 0;
    await studentDb.collection("sessions").doc(_session.id).collection("participants").doc(_uid).update({
      correctCount: newCorrect, answeredCount: newAnswered, percentage: pct,
      status: newAnswered >= total ? "done" : "in_progress",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) { console.error("[score aggregate update]", err); }
}

function _autoSubmitCurrentIfNeeded() {
  if (!_participant || !_session) return;
  const order = _participant.order || [];
  const idx = _participant.currentIndex || 0;
  if (idx >= order.length) return;
  const qId = order[idx];
  if (_autoSubmitLock.has(qId)) return;
  const answerDoc = _answers[qId];
  if (!answerDoc || answerDoc.answered) return;

  const inputEl = document.getElementById("answer-input");
  const draft = (inputEl && !inputEl.disabled ? inputEl.value : _drafts[qId]) || "";

  _autoSubmitLock.add(qId);
  _submitAnswer(qId, draft, true)
    .then(() => {
      // Advance the pointer so that if the session resumes (e.g. after a
      // teacher Reset), the student lands on their next unanswered question
      // instead of the one that was just force-submitted.
      if (idx < order.length - 1) return _writeCurrentIndex(idx + 1);
    })
    .catch((err) => console.warn("[auto-submit]", err))
    .finally(() => _autoSubmitLock.delete(qId));
}

function _tick() {
  if (!_session || _session.status !== "live" || !_session.deadline) return;
  const remainingMs = _session.deadline.toMillis() - Date.now();
  const remainingSec = Math.max(0, Math.round(remainingMs / 1000));
  const timerEl = document.getElementById("quiz-timer");
  if (timerEl) {
    timerEl.textContent = formatDuration(remainingSec);
    timerEl.classList.toggle("low-time", remainingSec <= 10 && remainingSec > 0);
  }
  if (remainingMs <= 0) _autoSubmitCurrentIfNeeded();
}

// ---------------------------------------------------------------- Finished

function _renderFinished() {
  const order = (_participant.order || []).slice();
  let correctCount = 0;
  const rows = order.map((qId, i) => {
    const a = _answers[qId];
    if (a && a.isCorrect) correctCount++;
    return { i, text: a ? a.questionText : "", studentAnswer: a ? a.studentAnswer : null, isCorrect: a ? a.isCorrect : false, answered: a ? a.answered : false };
  });
  const total = order.length;
  const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;

  document.getElementById("score-percent").textContent = `${pct}%`;
  document.getElementById("score-fill").style.width = `${pct}%`;
  document.getElementById("score-detail").textContent = `${correctCount} out of ${total} correct`;
  document.getElementById("finished-emoji").textContent = pct >= 80 ? "🎉" : pct >= 50 ? "👍" : "💪";

  document.getElementById("review-list").innerHTML = rows
    .map(
      (r) => `
      <div class="review-row">
        <div class="review-q">${r.i + 1}. ${escapeHtml(r.text)}</div>
        <div class="review-a ${r.answered ? (r.isCorrect ? "correct" : "incorrect") : ""}">
          ${r.answered ? `Your answer: ${escapeHtml(r.studentAnswer || "")} — ${r.isCorrect ? "Correct" : "Incorrect"}` : "Not answered"}
        </div>
      </div>`
    )
    .join("");
}
