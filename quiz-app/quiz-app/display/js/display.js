/**
 * Display view — no manual setup. Detects every currently-live session and
 * shows each as its own leaderboard panel in a responsive grid.
 *
 * [LESSON 1] Query filters on a single field (status == 'live') only —
 * sorting for stable panel order happens client-side in JS.
 * [LESSON 3] Every onSnapshot has an error callback with a plain-English
 * fallback message.
 */

let _liveSessions = [];
const _panelUnsubs = new Map(); // sessionId -> unsubscribe
const _panelData = new Map(); // sessionId -> {session, entries}

function initDisplay() {
  setInterval(_tickAllTimers, 1000);

  displayDb.collection("sessions").where("status", "==", "live").onSnapshot(
    (snap) => {
      _liveSessions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      _liveSessions.sort((a, b) => (a.startedAt?.seconds || 0) - (b.startedAt?.seconds || 0));
      _syncPanels();
    },
    (err) => {
      console.error("[display sessions listener]", err);
      showErrorToast(err);
    }
  );
}

function _syncPanels() {
  const grid = document.getElementById("sessions-grid");
  const idle = document.getElementById("idle-screen");

  if (_liveSessions.length === 0) {
    idle.style.display = "";
    grid.style.display = "none";
    grid.innerHTML = "";
    _panelUnsubs.forEach((unsub) => unsub());
    _panelUnsubs.clear();
    _panelData.clear();
    return;
  }

  idle.style.display = "none";
  grid.style.display = "grid";

  // Ensure a panel + listener exists for every currently-live session.
  _liveSessions.forEach((session) => {
    _panelData.set(session.id, { session, entries: (_panelData.get(session.id) || {}).entries || [] });
    if (!_panelUnsubs.has(session.id)) {
      const unsub = displayDb.collection("sessions").doc(session.id).collection("participants").onSnapshot(
        (snap) => {
          const entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          const existing = _panelData.get(session.id) || { session };
          _panelData.set(session.id, { ...existing, entries });
          _renderGrid();
        },
        (err) => {
          console.error("[display leaderboard listener]", err);
        }
      );
      _panelUnsubs.set(session.id, unsub);
    }
  });

  // Remove panels for sessions no longer live.
  const liveIds = new Set(_liveSessions.map((s) => s.id));
  Array.from(_panelUnsubs.keys()).forEach((id) => {
    if (!liveIds.has(id)) {
      _panelUnsubs.get(id)();
      _panelUnsubs.delete(id);
      _panelData.delete(id);
    }
  });

  _renderGrid();
}

function _renderGrid() {
  const grid = document.getElementById("sessions-grid");
  grid.innerHTML = _liveSessions.map((s) => _panelHtml(s.id)).join("");
}

function _panelHtml(sessionId) {
  const data = _panelData.get(sessionId);
  if (!data) return "";
  const { session, entries } = data;

  const ranked = computeRanks(entries.map((e) => ({ ...e, percentage: e.percentage || 0 })));
  ranked.sort((a, b) => a.rank - b.rank);
  const maxRank = ranked.length ? Math.max(...ranked.map((r) => r.rank)) : 0;

  const rows = ranked
    .map((r) => {
      const rowClass = r.rank === 1 ? "rank-1" : r.rank === maxRank && maxRank > 1 ? "rank-last" : "";
      return `
      <div class="board-row ${rowClass}">
        <div class="board-rank">${r.rank}</div>
        <div class="board-avatar">${avatarImgHtml(r, 56)}</div>
        <div class="board-name-wrap">
          <div class="board-name">${escapeHtml(r.name)}</div>
          <div class="board-progress progress-track" style="height:9px;"><div class="progress-fill" style="width:${r.percentage || 0}%;"></div></div>
        </div>
        <div class="board-score">${r.percentage || 0}%</div>
      </div>`;
    })
    .join("");

  return `
    <div class="session-panel">
      <div class="panel-header">
        <h2>${escapeHtml(session.subjectName)}</h2>
        <div class="panel-timer" data-timer-for="${session.id}">--:--</div>
      </div>
      ${rows || '<p class="empty-hint">Waiting for students to join in…</p>'}
    </div>
  `;
}

function _tickAllTimers() {
  document.querySelectorAll("[data-timer-for]").forEach((el) => {
    const id = el.dataset.timerFor;
    const data = _panelData.get(id);
    if (!data || !data.session) return;
    const { session } = data;
    if (session.status === "live" && session.deadline) {
      const remaining = Math.max(0, Math.round((session.deadline.toMillis() - Date.now()) / 1000));
      el.textContent = formatDuration(remaining);
    }
  });
}

let _displayInitialized = false;
ensureDisplaySignedIn(() => {
  if (_displayInitialized) return;
  _displayInitialized = true;
  initDisplay();
});
