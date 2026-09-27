/**
 * History of ended sessions, with CSV/PDF export.
 *
 * IMPORTANT: exports never trust the participant doc's live "percentage"
 * convenience field. They recompute every score directly from each
 * student's answers/ subcollection — the one place correctness is
 * rule-verified and cannot have been tampered with by a student's browser.
 */

function initHistory() {
  document.getElementById("btn-clear-all-history").addEventListener("click", _confirmClearAllHistory);
}

function renderHistoryList() {
  const el = document.getElementById("history-list");
  const sessions = _endedSessions();
  if (sessions.length === 0) {
    el.innerHTML = `<p class="empty-hint">No ended sessions yet.</p>`;
    return;
  }
  el.innerHTML = sessions
    .map(
      (s) => `
    <div class="card session-card">
      <div class="session-card-head">
        <div class="session-title-wrap">
          <div class="session-title"><h4>${escapeHtml(s.subjectName)}</h4>${_statusBadge("ended")}</div>
          <div class="session-meta">${s.studentIds.length} students · ${s.questionCount} questions · Ended ${formatDateTime(s.endedAt)}</div>
        </div>
      </div>
      <div class="session-controls">
        <button class="btn btn-secondary btn-sm" data-view="${s.id}">View results</button>
        <button class="btn btn-secondary btn-sm" data-csv="${s.id}">Export CSV</button>
        <button class="btn btn-secondary btn-sm" data-pdf="${s.id}">Export PDF</button>
        <button class="btn btn-ghost btn-sm" data-del="${s.id}">Delete permanently</button>
      </div>
      <div data-history-detail-for="${s.id}"></div>
    </div>
  `
    )
    .join("");

  sessions.forEach((s) => {
    document.querySelector(`[data-view="${s.id}"]`).addEventListener("click", () => _toggleHistoryDetail(s));
    document.querySelector(`[data-csv="${s.id}"]`).addEventListener("click", () => _exportCsv(s));
    document.querySelector(`[data-pdf="${s.id}"]`).addEventListener("click", () => _exportPdf(s));
    document.querySelector(`[data-del="${s.id}"]`).addEventListener("click", () => deleteSession(s));
  });
}

/** Recomputes authoritative per-student results for a session from the answers subcollection. */
async function _computeSessionResults(session) {
  const participantsSnap = await adminDb.collection("sessions").doc(session.id).collection("participants").get();
  const perStudent = [];

  for (const pDoc of participantsSnap.docs) {
    const p = { id: pDoc.id, ...pDoc.data() };
    const answersSnap = await adminDb.collection("sessions").doc(session.id).collection("participants").doc(p.id).collection("answers").get();
    const rows = answersSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    const correctCount = rows.filter((r) => r.isCorrect === true).length;
    const totalQuestions = rows.length;
    const percentage = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

    perStudent.push({ studentId: p.id, name: p.name, avatarType: p.avatarType, photoBase64: p.photoBase64, rows, correctCount, totalQuestions, percentage });
  }

  const ranked = computeRanks(perStudent);
  const topRank = ranked.length ? Math.min(...ranked.map((r) => r.rank)) : null;
  ranked.forEach((r) => (r.isWinner = r.rank === topRank));
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked;
}

async function _toggleHistoryDetail(session) {
  const el = document.querySelector(`[data-history-detail-for="${session.id}"]`);
  if (!el) return;
  if (el.dataset.open === "true") {
    el.innerHTML = "";
    el.dataset.open = "false";
    return;
  }
  el.innerHTML = `<p class="empty-hint">Loading results…</p>`;
  try {
    const results = await _computeSessionResults(session);
    el.innerHTML = `
      <table class="leaderboard-table" style="margin-top:16px;">
        <thead><tr><th>#</th><th>Student</th><th>Score</th><th></th></tr></thead>
        <tbody>
          ${results
            .map(
              (r) => `<tr>
                <td class="leaderboard-rank">${r.rank}</td>
                <td><div class="leaderboard-name-cell">${avatarImgHtml(r, 34)}<span>${escapeHtml(r.name)}${r.isWinner ? " 🏆" : ""}</span></div></td>
                <td class="leaderboard-pct">${r.correctCount}/${r.totalQuestions} · ${r.percentage}%</td>
                <td></td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
    el.dataset.open = "true";
  } catch (err) {
    el.innerHTML = `<p class="empty-hint">${escapeHtml(translateError(err))}</p>`;
  }
}

// -------------------------------------------------------------- CSV export

async function _exportCsv(session) {
  showToast("Preparing CSV…", "info", 2500);
  try {
    const results = await _computeSessionResults(session);
    let csv = "";
    csv += csvRow(["Subject", session.subjectName]);
    csv += csvRow(["Ended", formatDateTime(session.endedAt)]);
    csv += csvRow(["Timer (minutes)", session.timerMinutes]);
    csv += "\r\n";

    results.forEach((r) => {
      csv += csvRow([`Student: ${r.name}`, `Score: ${r.correctCount}/${r.totalQuestions} (${r.percentage}%)`, r.isWinner ? "WINNER" : ""]);
      csv += csvRow(["Question", "Their answer", "Correct answer", "Result"]);
      r.rows.forEach((row) => {
        csv += csvRow([
          row.questionText,
          row.studentAnswer == null ? "(no answer)" : row.studentAnswer,
          (row.acceptedAnswersDisplay || []).join(" / "),
          row.isCorrect == null ? "Not answered" : row.isCorrect ? "Correct" : "Incorrect",
        ]);
      });
      csv += "\r\n";
    });

    const safeName = session.subjectName.replace(/[^a-z0-9]+/gi, "-");
    downloadTextFile(`${safeName}-results.csv`, csv);
  } catch (err) { showErrorToast(err); }
}

// -------------------------------------------------------------- PDF export

async function _exportPdf(session) {
  showToast("Preparing PDF…", "info", 2500);
  try {
    const results = await _computeSessionResults(session);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const marginX = 40;
    let y = 50;
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();

    const ensureSpace = (needed) => {
      if (y + needed > pageHeight - 40) { doc.addPage(); y = 50; }
    };

    doc.setFont("helvetica", "bold"); doc.setFontSize(18);
    doc.text(`${session.subjectName} — Results`, marginX, y); y += 22;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(`Ended: ${formatDateTime(session.endedAt)}   Timer: ${session.timerMinutes} min   Students: ${results.length}`, marginX, y);
    y += 26;

    results.forEach((r) => {
      ensureSpace(60);
      doc.setFont("helvetica", "bold"); doc.setFontSize(13);
      doc.text(`${r.rank}. ${r.name}${r.isWinner ? "  (Winner)" : ""}`, marginX, y); y += 16;
      doc.setFont("helvetica", "normal"); doc.setFontSize(10);
      doc.text(`Score: ${r.correctCount}/${r.totalQuestions} (${r.percentage}%)`, marginX, y); y += 16;

      r.rows.forEach((row, i) => {
        ensureSpace(44);
        const qLines = doc.splitTextToSize(`${i + 1}. ${row.questionText}`, pageWidth - marginX * 2);
        doc.setFont("helvetica", "bold"); doc.text(qLines, marginX, y); y += qLines.length * 12;
        doc.setFont("helvetica", "normal");
        const theirs = row.studentAnswer == null ? "(no answer)" : row.studentAnswer;
        const correct = (row.acceptedAnswersDisplay || []).join(" / ");
        const result = row.isCorrect == null ? "Not answered" : row.isCorrect ? "Correct" : "Incorrect";
        doc.text(`Their answer: ${theirs}   |   Correct answer: ${correct}   |   ${result}`, marginX + 12, y);
        y += 16;
      });
      y += 10;
    });

    const safeName = session.subjectName.replace(/[^a-z0-9]+/gi, "-");
    doc.save(`${safeName}-results.pdf`);
  } catch (err) { showErrorToast(err); }
}

// -------------------------------------------------------------- Clear all

function _confirmClearAllHistory() {
  const sessions = _endedSessions();
  if (sessions.length === 0) { showToast("There's no history to clear.", "info"); return; }
  openModal(
    `
    <h3>Clear ALL session history?</h3>
    <p>This permanently deletes all ${sessions.length} ended session${sessions.length === 1 ? "" : "s"} and every student's results in them. This can't be undone.</p>
    <div style="display:flex; gap:10px; margin-top:20px;">
      <button type="button" class="btn btn-secondary" id="cancel-btn">Cancel</button>
      <button type="button" class="btn btn-danger" id="confirm-btn">Clear all history</button>
    </div>
  `,
    (modal) => {
      modal.querySelector("#cancel-btn").addEventListener("click", closeModal);
      modal.querySelector("#confirm-btn").addEventListener("click", async () => {
        const btn = modal.querySelector("#confirm-btn");
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Clearing…';
        try {
          for (const s of sessions) await _deleteSessionCompletely(s);
          closeModal();
          showToast("All history cleared.", "success");
        } catch (err) { showErrorToast(err); }
      });
    }
  );
}
