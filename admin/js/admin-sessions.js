/**
 * Session creation + live control.
 *
 * [LESSON 1] All Firestore queries here filter on a single field only and
 * sort client-side in JS — never where()+orderBy() on different fields.
 *
 * [LESSON 5] Whenever a session's status/deadline/resetToken changes, we
 * write those same fields directly onto every participant doc AND every
 * answers/{questionId} doc for that session (see syncSessionStateToAll).
 * That is what lets the Security Rules validate a student's answer
 * submission by reading only the one document being written.
 */
window.AdminState = window.AdminState || {};
AdminState.sessions = [];

const RESET_GRACE_MS = 6000; // window during which clients can auto-submit their open question
const _sessionLeaderboardUnsubs = new Map(); // sessionId -> unsubscribe fn
const _timerIntervalHandles = [];

function initSessions() {
  document.getElementById("btn-create-session").addEventListener("click", openCreateSessionModal);

  adminDb.collection("sessions").onSnapshot(
    (snap) => {
      AdminState.sessions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      try { renderSessionsList(); } catch (err) {
        console.error("[render live sessions]", err);
        document.getElementById("sessions-list").innerHTML =
          `<p class="empty-hint">Sessions exist but couldn't be displayed. Please press F12, open Console, and send the red error to your developer.</p>`;
      }
      try { renderHistoryList(); } catch (err) { console.error("[render history]", err); }
      document.dispatchEvent(new CustomEvent("admin:sessions-updated"));
    },
    (err) => {
      console.error("[sessions listener]", err);
      showErrorToast(err);
      document.getElementById("sessions-list").innerHTML =
        `<p class="empty-hint">Couldn't load sessions. ${escapeHtml(translateError(err))}</p>`;
    }
  );

  // One shared ticking clock for every visible countdown.
  setInterval(_tickTimers, 1000);
}

function _activeSessions() {
  return AdminState.sessions.filter((s) => s.status !== "ended").sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

function _endedSessions() {
  return AdminState.sessions.filter((s) => s.status === "ended").sort((a, b) => (b.endedAt?.seconds || 0) - (a.endedAt?.seconds || 0));
}

/** Student ids currently tied up in some OTHER live/paused session. */
function _studentsCurrentlyActive(excludeSessionId) {
  const set = new Set();
  AdminState.sessions.forEach((s) => {
    if (s.id === excludeSessionId) return;
    if (s.status === "live" || s.status === "paused") (s.studentIds || []).forEach((id) => set.add(id));
  });
  return set;
}

// --------------------------------------------------------- Create session

function openCreateSessionModal() {
  const eligibleSubjects = AdminState.subjects.filter((s) => (s.questionCount || 0) > 0);
  if (eligibleSubjects.length === 0) {
    showToast("Add a subject with at least one question first.", "error");
    return;
  }
  if (AdminState.students.length < 2) {
    showToast("Add at least 2 students to the roster first.", "error");
    return;
  }

  const busy = _studentsCurrentlyActive(null);

  openModal(
    `
    <h3>Create session</h3>
    <form id="create-session-form">
      <div class="field">
        <label for="cs-subject">Subject</label>
        <select id="cs-subject" required>
          ${eligibleSubjects.map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (${s.questionCount} question${s.questionCount === 1 ? "" : "s"})</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="cs-timer">Timer (minutes, 1–60)</label>
        <input type="number" id="cs-timer" min="1" max="60" step="1" value="10" required>
      </div>
      <div class="field">
        <label>Students (choose 2–10)</label>
        <div class="checklist">
          ${AdminState.students
      .map((s) => {
        const disabled = busy.has(s.id);
        return `<label class="${disabled ? "disabled" : ""}">
                <input type="checkbox" value="${s.id}" ${disabled ? "disabled" : ""}>
                ${escapeHtml(s.name)} ${disabled ? "<em>(busy in another session)</em>" : ""}
              </label>`;
      })
      .join("")}
        </div>
      </div>
      <p id="cs-error" class="form-error" role="alert"></p>
      <div style="display:flex; gap:10px; margin-top:12px;">
        <button type="button" class="btn btn-secondary" id="cancel-btn">Cancel</button>
        <button type="submit" class="btn btn-primary" id="submit-btn">Create session</button>
      </div>
    </form>
  `,
    (modal) => {
      modal.querySelector("#cancel-btn").addEventListener("click", closeModal);
      modal.querySelector("#create-session-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const errEl = modal.querySelector("#cs-error");
        const submitBtn = modal.querySelector("#submit-btn");
        errEl.textContent = "";

        const subjectId = modal.querySelector("#cs-subject").value;
        const timerMinutes = parseInt(modal.querySelector("#cs-timer").value, 10);
        const studentIds = Array.from(modal.querySelectorAll('input[type="checkbox"]:checked')).map((c) => c.value);

        if (!Number.isInteger(timerMinutes) || timerMinutes < 1 || timerMinutes > 60) {
          errEl.textContent = "Timer must be a whole number of minutes between 1 and 60.";
          return;
        }
        if (studentIds.length < 2 || studentIds.length > 10) {
          errEl.textContent = "Please select between 2 and 10 students.";
          return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner"></span> Creating…';
        try {
          const startedNow = await _createSession(subjectId, timerMinutes, studentIds);
          closeModal();
          showToast(startedNow ? "Spelling Bee started — students can type their answers now." : "Session created.", "success");
        } catch (err) {
          errEl.textContent = translateError(err);
          submitBtn.disabled = false;
          submitBtn.textContent = "Create session";
        }
      });
    }
  );
}

async function _createSession(subjectId, timerMinutes, studentIds) {
  const subject = AdminState.subjects.find((s) => s.id === subjectId);
  const qSnap = await adminDb.collection("subjects").doc(subjectId).collection("questions").get();
  const questions = sortByCreated(qSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
  if (questions.length === 0) throw new Error("This subject has no questions.");

  // Spelling Bee: everyone gets the SAME words in the teacher's order (no
  // shuffling), and the word itself is never stored as visible question text.
  const isSpelling = isSpellingBeeName(subject.name);

  // Spelling Bee starts the moment it's created: live status + a running deadline.
  const deadline = isSpelling
    ? firebase.firestore.Timestamp.fromMillis(Date.now() + timerMinutes * 60 * 1000)
    : null;
  const initialStatus = isSpelling ? "live" : "ready";

  const timerSeconds = timerMinutes * 60;
  const sessionRef = adminDb.collection("sessions").doc();
  const questionIds = questions.map((q) => q.id);

  const ops = [];
  ops.push({
    ref: sessionRef,
    data: {
      subjectId, subjectName: subject.name, subjectType: isSpelling ? "spelling" : "general",
      timerMinutes, timerSeconds, remainingSeconds: timerSeconds,
      studentIds, questionIds, questionCount: questions.length,
      status: initialStatus, deadline, resetToken: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      startedAt: isSpelling ? firebase.firestore.FieldValue.serverTimestamp() : null, pausedAt: null, endedAt: null,
      createdBy: ADMIN_UID,
    },
  });

  studentIds.forEach((studentId) => {
    const student = AdminState.students.find((s) => s.id === studentId);
    const order = isSpelling ? questionIds.slice() : shuffleArray(questionIds);
    const participantRef = sessionRef.collection("participants").doc(studentId);
    ops.push({
      ref: participantRef,
      data: {
        studentId, name: student.name, avatarType: student.avatarType || "neutral", photoBase64: student.photoBase64 || null,
        order, currentIndex: 0,
        correctCount: 0, answeredCount: 0, totalQuestions: questions.length, percentage: 0,
        status: "in_progress",
        sessionStatus: initialStatus, sessionDeadline: deadline, resetToken: 0,
        joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      },
    });
    questions.forEach((q, idx) => {
      const answerRef = participantRef.collection("answers").doc(q.id);
      ops.push({
        ref: answerRef,
        data: {
          questionId: q.id, questionText: isSpelling ? "" : q.text,
          acceptedAnswersLower: toLowerList(q.acceptedAnswers),
          acceptedAnswersDisplay: q.acceptedAnswers,
          answerType: isSpelling ? "typed" : (q.answerType || "typed"),
          options: (!isSpelling && q.answerType === "mcq") ? q.options : null,
          gradingMode: (isSpelling || q.answerType === "mcq") ? "exact" : "smart",
          order: order.indexOf(q.id),
          answered: false, studentAnswer: null, isCorrect: null, autoSubmitted: false, submittedAt: null,
          sessionStatus: initialStatus, sessionDeadline: deadline, resetToken: 0,
        },
      });
    });
  });

  await _commitOpsInChunks(ops, "set");
  return isSpelling;
}

/** Commits {ref,data} ops in Firestore batch-write chunks (max 450 per batch, under the 500 limit). */
async function _commitOpsInChunks(ops, mode) {
  const CHUNK = 450;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const batch = adminDb.batch();
    ops.slice(i, i + CHUNK).forEach((op) => {
      if (mode === "set") batch.set(op.ref, op.data, op.merge ? { merge: true } : {});
      else if (mode === "update") batch.update(op.ref, op.data);
      else if (mode === "delete") batch.delete(op.ref);
    });
    await batch.commit();
  }
}

// -------------------------------------------------- Sync state to children

/**
 * [LESSON 5] Copies status/deadline/resetToken from the session doc onto
 * every participant doc and every answers/{questionId} doc for that
 * session, so the Security Rules never need a cross-document get().
 */
async function _syncSessionStateToAll(session, extraFields) {
  const fields = {
    sessionStatus: session.status,
    sessionDeadline: session.deadline || null,
    resetToken: session.resetToken || 0,
    ...(extraFields || {}),
  };
  const ops = [];
  session.studentIds.forEach((studentId) => {
    const participantRef = adminDb.collection("sessions").doc(session.id).collection("participants").doc(studentId);
    ops.push({ ref: participantRef, data: fields });
    (session.questionIds || []).forEach((qId) => {
      ops.push({ ref: participantRef.collection("answers").doc(qId), data: fields });
    });
  });
  await _commitOpsInChunks(ops, "update");
}

// ---------------------------------------------------------- Session cards

function renderSessionsList() {
  const el = document.getElementById("sessions-list");
  const sessions = _activeSessions();
  if (sessions.length === 0) {
    const total = AdminState.sessions.length;
    el.innerHTML = `<p class="empty-hint">No sessions running. Create one to get started.${total ? ` (${total} finished session${total === 1 ? "" : "s"} can be found under History.)` : ""}</p>`;
    // detach any stray leaderboard listeners
    _sessionLeaderboardUnsubs.forEach((unsub) => unsub());
    _sessionLeaderboardUnsubs.clear();
    return;
  }

  el.innerHTML = sessions
    .map((s) => {
      try { return _sessionCardHtml(s); }
      catch (err) { console.error("[session card]", s.id, err); return _brokenSessionCardHtml(s); }
    })
    .join("");

  sessions.forEach((s) => {
    try {
      _wireSessionCard(s);
      if (!_sessionLeaderboardUnsubs.has(s.id)) _attachLeaderboardListener(s.id);
    } catch (err) { console.error("[wire session card]", s.id, err); }
  });
  el.querySelectorAll("[data-remove-broken]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const sess = AdminState.sessions.find((x) => x.id === btn.dataset.removeBroken);
      if (sess) deleteSession(sess);
    })
  );

  // Detach listeners for sessions that disappeared (ended+moved to history, or deleted)
  const liveIds = new Set(sessions.map((s) => s.id));
  Array.from(_sessionLeaderboardUnsubs.keys()).forEach((id) => {
    if (!liveIds.has(id)) {
      _sessionLeaderboardUnsubs.get(id)();
      _sessionLeaderboardUnsubs.delete(id);
    }
  });
}

/** Fallback card so a malformed session can still be seen and removed. */
function _brokenSessionCardHtml(s) {
  return `
    <div class="card session-card" data-session-id="${s.id}">
      <div class="session-title"><h4>${escapeHtml(s.subjectName || "Unnamed session")}</h4>${_statusBadge(s.status)}</div>
      <p class="session-meta">This session's details are incomplete, so its controls can't be shown.</p>
      <button class="btn btn-danger btn-sm" data-remove-broken="${s.id}">Remove this session</button>
    </div>`;
}

function _statusBadge(status) {
  const map = { ready: ["badge-ready", "Ready"], live: ["badge-live", "Live"], paused: ["badge-paused", "Paused"], ended: ["badge-ended", "Ended"] };
  const [cls, label] = map[status] || ["badge-ended", status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function _sessionCardHtml(s) {
  return `
    <div class="card session-card" data-session-id="${s.id}">
      <div class="session-card-head">
        <div class="session-title-wrap">
          <div class="session-title">
            <h4>${escapeHtml(s.subjectName)}</h4>
            ${_statusBadge(s.status)}
          </div>
          <div class="session-meta">${s.studentIds.length} students · ${s.questionCount} questions · ${s.timerMinutes} min timer</div>
        </div>
        <div class="session-timer" data-timer-for="${s.id}">--:--</div>
      </div>
      <div class="session-controls" data-controls-for="${s.id}"></div>
      <div data-leaderboard-for="${s.id}"><p class="empty-hint">Loading leaderboard…</p></div>
    </div>
  `;
}

function _wireSessionCard(s) {
  const controls = document.querySelector(`[data-controls-for="${s.id}"]`);
  if (!controls) return;
  const buttons = [];
  if (s.status === "ready" || s.status === "paused") buttons.push(`<button class="btn btn-primary btn-sm" data-action="start">${s.status === "paused" ? "Resume (Start)" : "Start"}</button>`);
  if (s.status === "live") buttons.push(`<button class="btn btn-secondary btn-sm" data-action="pause">Pause</button>`);
  if (s.status === "live" || s.status === "paused") buttons.push(`<button class="btn btn-secondary btn-sm" data-action="reset">Reset timer</button>`);
  if (s.status === "ready" || s.status === "paused") buttons.push(`<button class="btn btn-ghost btn-sm" data-action="clear-history">Clear history</button>`);
  if (s.status === "ready") buttons.push(`<button class="btn btn-danger btn-sm" data-action="cancel">Cancel session</button>`);
  if (s.status === "live" || s.status === "paused") buttons.push(`<button class="btn btn-danger btn-sm" data-action="end">End session</button>`);
  controls.innerHTML = buttons.join("");

  controls.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => _handleSessionAction(s, btn.dataset.action));
  });
}

const EXPIRY_GRACE_MS = 6000; // the Security Rules accept submissions up to 5s after the deadline
const _transitioning = new Map(); // sessionId -> label shown instead of the timer

async function _runTransition(sessionId, label, fn) {
  if (_transitioning.has(sessionId)) return;
  _transitioning.set(sessionId, label);
  try { await fn(); } finally { _transitioning.delete(sessionId); }
}

/**
 * When a session's timer runs out, the students' screens submit their open
 * question by themselves. A few seconds later (once the last submissions had
 * time to arrive) the session is ended automatically — for EVERY subject, with
 * no button press and no timer restart.
 */
function _autoEndExpiredSessions() {
  AdminState.sessions.forEach((s) => {
    if (s.status !== "live" || !s.deadline || _transitioning.has(s.id)) return;
    if (Date.now() < s.deadline.toMillis() + EXPIRY_GRACE_MS) return;
    _runTransition(s.id, "Finishing…", () => _endAfterTimeout(s))
      .catch((err) => console.error("[auto-end on timeout]", err));
  });
}

async function _endAfterTimeout(session) {
  await adminDb.collection("sessions").doc(session.id).update({
    status: "ended", deadline: null,
    endedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  await _syncSessionStateToAll({ ...session, status: "ended", deadline: null }, {});
  try { await _finalizeSession(session); } catch (err) { console.error("[finalize session]", err); }
  showToast(`${session.subjectName} finished — the time was up.`, "success");
}

/**
 * Spelling Bee only: once EVERY student has answered their last word, end the
 * session (and so the timer) automatically. The participant counters are only
 * a trigger — before ending, the answers records themselves are checked.
 */
async function _maybeAutoEndWhenAllDone(sessionId, entries) {
  const s = AdminState.sessions.find((x) => x.id === sessionId);
  if (!s || s.status !== "live" || s.subjectType !== "spelling" || _transitioning.has(sessionId)) return;
  if (entries.length === 0 || entries.length < s.studentIds.length) return;
  if (!entries.every((e) => (e.answeredCount || 0) >= (e.totalQuestions || s.questionCount))) return;

  await _runTransition(sessionId, "Finishing…", async () => {
    try {
      for (const studentId of s.studentIds) {
        const snap = await adminDb.collection("sessions").doc(sessionId).collection("participants").doc(studentId).collection("answers").get();
        if (snap.docs.some((d) => d.data().answered !== true)) return; // not really done
      }
      await adminDb.collection("sessions").doc(sessionId).update({
        status: "ended", deadline: null,
        endedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      await _syncSessionStateToAll({ ...s, status: "ended", deadline: null }, {});
      try { await _finalizeSession(s); } catch (err) { console.error("[finalize session]", err); }
      showToast("Every student has finished — the Spelling Bee has ended.", "success");
    } catch (err) {
      console.error("[auto-end when all done]", err);
    }
  });
}

function _tickTimers() {
  _autoEndExpiredSessions();
  document.querySelectorAll("[data-timer-for]").forEach((el) => {
    const id = el.dataset.timerFor;
    const s = AdminState.sessions.find((x) => x.id === id);
    if (!s) return;
    if (_transitioning.has(id)) {
      el.textContent = _transitioning.get(id);
    } else if (s.status === "live" && s.deadline) {
      const remaining = Math.max(0, Math.round((s.deadline.toMillis() - Date.now()) / 1000));
      el.textContent = formatDuration(remaining);
    } else if (s.status === "paused") {
      el.textContent = formatDuration(s.remainingSeconds || 0);
    } else if (s.status === "ready") {
      el.textContent = formatDuration(s.timerSeconds || 0);
    } else {
      el.textContent = "—";
    }
  });
}

function _attachLeaderboardListener(sessionId) {
  const unsub = adminDb.collection("sessions").doc(sessionId).collection("participants").onSnapshot(
    (snap) => {
      const entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      _renderSessionLeaderboard(sessionId, entries);
      _maybeAutoEndWhenAllDone(sessionId, entries);
    },
    (err) => {
      console.error("[leaderboard listener]", err);
      const el = document.querySelector(`[data-leaderboard-for="${sessionId}"]`);
      if (el) el.innerHTML = `<p class="empty-hint">Couldn't load live scores. ${escapeHtml(translateError(err))}</p>`;
    }
  );
  _sessionLeaderboardUnsubs.set(sessionId, unsub);
}

function _renderSessionLeaderboard(sessionId, entries) {
  const el = document.querySelector(`[data-leaderboard-for="${sessionId}"]`);
  if (!el) return;
  const ranked = computeRanks(entries.map((e) => ({ ...e, percentage: e.percentage || 0 })));
  ranked.sort((a, b) => a.rank - b.rank);
  el.innerHTML = `
    <table class="leaderboard-table">
      <thead><tr><th>#</th><th>Student</th><th>Progress</th><th>Score</th></tr></thead>
      <tbody>
        ${ranked
      .map(
        (r) => `
          <tr>
            <td class="leaderboard-rank">${r.rank}</td>
            <td><div class="leaderboard-name-cell">${avatarImgHtml(r, 34)}<span>${escapeHtml(r.name)}</span></div></td>
            <td class="leaderboard-bar-cell"><div class="progress-track"><div class="progress-fill" style="width:${r.percentage}%;"></div></div></td>
            <td class="leaderboard-pct">${r.answeredCount || 0}/${r.totalQuestions} · ${r.percentage || 0}%</td>
          </tr>`
      )
      .join("")}
      </tbody>
    </table>
  `;
}

// -------------------------------------------------------------- Actions

async function _handleSessionAction(session, action) {
  try {
    if (action === "start") await _startSession(session);
    else if (action === "pause") await _pauseSession(session);
    else if (action === "reset") await _runTransition(session.id, "Resetting…", () => _resetSession(session));
    else if (action === "end") await _runTransition(session.id, "Ending…", () => _endSession(session));
    else if (action === "cancel") await _confirmCancelSession(session);
    else if (action === "clear-history") {
      const snap = await adminDb.collection("sessions").doc(session.id).collection("participants").get();
      if (!snap.docs.some((d) => (d.data().answeredCount || 0) > 0)) {
        showToast("Nothing to clear yet — no student has submitted an answer in this session.", "info", 5000);
        return;
      }
      await _confirmClearHistory(session);
    }
  } catch (err) {
    showErrorToast(err);
  }
}

async function _startSession(session) {
  // A student may only be in ONE running session at a time.
  const busy = _studentsCurrentlyActive(session.id);
  const clashes = (session.studentIds || []).filter((id) => busy.has(id))
    .map((id) => (AdminState.students.find((st) => st.id === id) || {}).name || "A student");
  if (clashes.length) {
    showToast(`${clashes.join(", ")} ${clashes.length > 1 ? "are" : "is"} already in another running session. End that session first.`, "error", 7000);
    return;
  }
  const remainingSeconds = session.status === "paused" ? session.remainingSeconds : session.timerSeconds;
  const deadline = firebase.firestore.Timestamp.fromMillis(Date.now() + remainingSeconds * 1000);
  const sessionRef = adminDb.collection("sessions").doc(session.id);
  const update = { status: "live", deadline, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
  if (!session.startedAt) update.startedAt = firebase.firestore.FieldValue.serverTimestamp();
  await sessionRef.update(update);
  await _syncSessionStateToAll({ ...session, status: "live", deadline }, {});
  showToast("Session started.", "success");
}

async function _pauseSession(session) {
  const remainingSeconds = session.deadline ? Math.max(0, Math.round((session.deadline.toMillis() - Date.now()) / 1000)) : 0;
  const sessionRef = adminDb.collection("sessions").doc(session.id);
  await sessionRef.update({
    status: "paused", deadline: null, remainingSeconds,
    pausedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  await _syncSessionStateToAll({ ...session, status: "paused", deadline: null }, {});
  showToast("Session paused. It will stay frozen until you click Start again.", "success");
}

async function _resetSession(session) {
  showToast("Resetting — capturing each student's current question…", "info", RESET_GRACE_MS);
  const sessionRef = adminDb.collection("sessions").doc(session.id);
  const newResetToken = (session.resetToken || 0) + 1;
  const graceDeadline = firebase.firestore.Timestamp.fromMillis(Date.now() + RESET_GRACE_MS);

  // Step 1: brief "live" grace window (even if it was paused/ready) so every
  // student's client can auto-submit whatever question is currently open.
  await sessionRef.update({
    status: "live", deadline: graceDeadline, resetToken: newResetToken,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  await _syncSessionStateToAll({ ...session, status: "live", deadline: graceDeadline, resetToken: newResetToken }, {});

  await new Promise((resolve) => setTimeout(resolve, RESET_GRACE_MS + 500));

  // Step 2: land back on "ready" with a full timer, previously-locked answers untouched.
  await sessionRef.update({
    status: "ready", deadline: null, remainingSeconds: session.timerSeconds,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  await _syncSessionStateToAll({ ...session, status: "ready", deadline: null, resetToken: newResetToken }, {});
  showToast("Timer reset. Click Start when you're ready to begin again.", "success");
}

async function _endSession(session) {
  showToast("Ending — capturing each student's current question…", "info", RESET_GRACE_MS);
  const sessionRef = adminDb.collection("sessions").doc(session.id);
  const newResetToken = (session.resetToken || 0) + 1;
  const graceDeadline = firebase.firestore.Timestamp.fromMillis(Date.now() + RESET_GRACE_MS);

  await sessionRef.update({
    status: "live", deadline: graceDeadline, resetToken: newResetToken,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  await _syncSessionStateToAll({ ...session, status: "live", deadline: graceDeadline, resetToken: newResetToken }, {});

  await new Promise((resolve) => setTimeout(resolve, RESET_GRACE_MS + 500));

  await sessionRef.update({
    status: "ended", deadline: null,
    endedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  await _syncSessionStateToAll({ ...session, status: "ended", deadline: null, resetToken: newResetToken }, {});
  try { await _finalizeSession(session); } catch (err) { console.error("[finalize session]", err); }
  showToast("Session ended. Find it under History.", "success");
}

/**
 * Called once a session has ended. Recomputes every student's score from the
 * tamper-proof answers records, writes the official numbers back onto the
 * participant docs (so the Display shows final results), and stores a summary
 * on the session doc for the History page.
 */
async function _finalizeSession(session) {
  const results = await _computeSessionResults(session);
  if (results.length === 0) return;

  const ops = results.map((r) => ({
    ref: adminDb.collection("sessions").doc(session.id).collection("participants").doc(r.studentId),
    data: {
      correctCount: r.correctCount,
      answeredCount: r.rows.filter((x) => x.answered === true).length,
      totalQuestions: r.totalQuestions,
      percentage: r.percentage,
      status: "done",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    },
  }));
  // Smart-graded answers: store the teacher-side re-grade so students see the official result.
  results.forEach((r) => {
    r.rows.filter((row) => row._needsWrite).forEach((row) => {
      ops.push({
        ref: adminDb.collection("sessions").doc(session.id).collection("participants").doc(r.studentId).collection("answers").doc(row.id),
        data: { isCorrect: row.isCorrect },
      });
    });
  });
  await _commitOpsInChunks(ops, "update");

  const pcts = results.map((r) => r.percentage);
  const summary = {
    participantCount: results.length,
    questionCount: results[0].totalQuestions,
    averagePercentage: Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length),
    highestPercentage: Math.max(...pcts),
    lowestPercentage: Math.min(...pcts),
    winners: results.filter((r) => r.isWinner).map((r) => r.name),
    results: results.map((r) => ({
      studentId: r.studentId, name: r.name, rank: r.rank,
      correctCount: r.correctCount, totalQuestions: r.totalQuestions, percentage: r.percentage,
    })),
    finalizedAtMs: Date.now(),
  };
  await adminDb.collection("sessions").doc(session.id).update({ summary });
}

async function _confirmCancelSession(session) {
  openModal(
    `
    <h3>Cancel this session?</h3>
    <p>"${escapeHtml(session.subjectName)}" hasn't started, so nothing is lost. It will be removed completely.</p>
    <div style="display:flex; gap:10px; margin-top:20px;">
      <button type="button" class="btn btn-secondary" id="cancel-btn">Keep it</button>
      <button type="button" class="btn btn-danger" id="confirm-btn">Cancel session</button>
    </div>
  `,
    (modal) => {
      modal.querySelector("#cancel-btn").addEventListener("click", closeModal);
      modal.querySelector("#confirm-btn").addEventListener("click", async () => {
        const btn = modal.querySelector("#confirm-btn");
        btn.disabled = true;
        try {
          await _deleteSessionCompletely(session);
          closeModal();
          showToast("Session cancelled.", "success");
        } catch (err) { showErrorToast(err); btn.disabled = false; }
      });
    }
  );
}

async function _confirmClearHistory(session) {
  openModal(
    `
    <h3>Clear all student history for this session?</h3>
    <p>Every student's answers and scores for "${escapeHtml(session.subjectName)}" will be wiped back to zero, and their questions will be freshly re-shuffled. The timer itself is not affected by this — use Reset for that.</p>
    <div style="display:flex; gap:10px; margin-top:20px;">
      <button type="button" class="btn btn-secondary" id="cancel-btn">Cancel</button>
      <button type="button" class="btn btn-danger" id="confirm-btn">Clear history</button>
    </div>
  `,
    (modal) => {
      modal.querySelector("#cancel-btn").addEventListener("click", closeModal);
      modal.querySelector("#confirm-btn").addEventListener("click", async () => {
        try {
          await _clearSessionHistory(session);
          closeModal();
          showToast("Student history cleared for this session.", "success");
        } catch (err) { showErrorToast(err); }
      });
    }
  );
}

async function _clearSessionHistory(session) {
  const ops = [];
  for (const studentId of session.studentIds) {
    const participantRef = adminDb.collection("sessions").doc(session.id).collection("participants").doc(studentId);
    const newOrder = session.subjectType === "spelling" ? session.questionIds.slice() : shuffleArray(session.questionIds);
    ops.push({
      ref: participantRef,
      data: {
        order: newOrder, currentIndex: 0, correctCount: 0, answeredCount: 0, percentage: 0, status: "in_progress",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      },
    });
    session.questionIds.forEach((qId, idx) => {
      ops.push({
        ref: participantRef.collection("answers").doc(qId),
        data: { answered: false, studentAnswer: null, isCorrect: null, autoSubmitted: false, submittedAt: null, order: newOrder.indexOf(qId) },
      });
    });
  }
  await _commitOpsInChunks(ops, "update");
}

// -------------------------------------------------------- Delete (History)

async function deleteSession(session) {
  openModal(
    `
    <h3>Permanently delete this session?</h3>
    <p>This deletes "${escapeHtml(session.subjectName || "this session")}" and every student's results for it. This can't be undone.</p>
    <div style="display:flex; gap:10px; margin-top:20px;">
      <button type="button" class="btn btn-secondary" id="cancel-btn">Cancel</button>
      <button type="button" class="btn btn-danger" id="confirm-btn">Delete permanently</button>
    </div>
  `,
    (modal) => {
      modal.querySelector("#cancel-btn").addEventListener("click", closeModal);
      modal.querySelector("#confirm-btn").addEventListener("click", async () => {
        try {
          await _deleteSessionCompletely(session);
          closeModal();
          showToast("Session deleted permanently.", "success");
        } catch (err) { showErrorToast(err); }
      });
    }
  );
}

async function _deleteSessionCompletely(session) {
  const ops = [];
  for (const studentId of (session.studentIds || [])) {
    const participantRef = adminDb.collection("sessions").doc(session.id).collection("participants").doc(studentId);
    (session.questionIds || []).forEach((qId) => ops.push({ ref: participantRef.collection("answers").doc(qId) }));
    ops.push({ ref: participantRef });
  }
  ops.push({ ref: adminDb.collection("sessions").doc(session.id) });
  await _commitOpsInChunks(ops, "delete");
}