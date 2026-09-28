/**
 * Display view — no manual setup.
 *  - Every LIVE session appears as a leaderboard panel (responsive grid).
 *  - When a session ENDS, its panel turns into a "Final results" panel showing
 *    each position with the students' photos and names. Ties share a position
 *    (e.g. "Second position is a tie") and every tied student is shown.
 *    Results stay on screen for RESULTS_WINDOW_MS after the session ends.
 *
 * [LESSON 1] Both queries filter on ONE field only (status); sorting is JS.
 * [LESSON 3] Every onSnapshot has an error callback with a plain message.
 */
const RESULTS_WINDOW_MS = 2 * 60 * 60 * 1000; // safety limit only; results normally leave when the next quiz starts

let _live = [];
let _ended = [];
let _visible = [];
const _panelUnsubs = new Map(); // sessionId -> unsubscribe
const _entriesBySession = new Map(); // sessionId -> participant entries

function initDisplay() {
  setInterval(_tickAllTimers, 1000);
  setInterval(_recompute, 4000); // lets old results expire and finished timers flip to results

  displayDb.collection("sessions").where("status", "==", "live").onSnapshot(
    (snap) => { _live = snap.docs.map((d) => ({ id: d.id, ...d.data() })); _recompute(); },
    (err) => { console.error("[display live listener]", err); _showProblem(err); }
  );
  displayDb.collection("sessions").where("status", "==", "ended").onSnapshot(
    (snap) => { _ended = snap.docs.map((d) => ({ id: d.id, ...d.data() })); _recompute(); },
    (err) => { console.error("[display ended listener]", err); _showProblem(err); }
  );
}

function _showProblem(err) {
  const idle = document.getElementById("idle-screen");
  idle.innerHTML = `<span class="big-emoji">📡</span><h2>Can't load the quiz right now</h2><p>${escapeHtml(translateError(err))}</p>`;
}

function _startMs(s, now) { return s.startedAt ? s.startedAt.toMillis() : now; }
function _endMs(s, now) {
  if (s.status === "ended") return s.endedAt ? s.endedAt.toMillis() : now;
  return s.deadline ? s.deadline.toMillis() : now;
}

/**
 * What the big screen shows:
 *  - every quiz that is still running (live panels);
 *  - the final results of a quiz that has finished — but ONLY until a newer
 *    quiz starts. Once a new quiz begins, the earlier results disappear from
 *    the display (the teacher can still open them under History).
 */
function _recompute() {
  const now = Date.now();
  const running = _live.filter((s) => !_isFinished(s))
    .sort((a, b) => _startMs(a, now) - _startMs(b, now));
  const finishedAll = [..._ended, ..._live.filter((s) => _isFinished(s))];
  const everySession = [...running, ...finishedAll];

  // A finished quiz's results are dropped as soon as ANY other quiz has started
  // after it ended, so an old quiz never comes back on the screen.
  const finished = finishedAll
    .filter((f) => {
      const end = _endMs(f, now);
      if (now - end > RESULTS_WINDOW_MS) return false;
      return !everySession.some((g) => g.id !== f.id && _startMs(g, now) > end);
    })
    .sort((a, b) => _endMs(b, now) - _endMs(a, now));

  _visible = [...running, ...finished];
  _syncListeners();
  _renderGrid();
}

function _syncListeners() {
  const ids = new Set(_visible.map((s) => s.id));
  _visible.forEach((session) => {
    if (_panelUnsubs.has(session.id)) return;
    const unsub = displayDb.collection("sessions").doc(session.id).collection("participants").onSnapshot(
      (snap) => {
        _entriesBySession.set(session.id, snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        _renderGrid();
      },
      (err) => console.error("[display participants listener]", err)
    );
    _panelUnsubs.set(session.id, unsub);
  });
  Array.from(_panelUnsubs.keys()).forEach((id) => {
    if (!ids.has(id)) { _panelUnsubs.get(id)(); _panelUnsubs.delete(id); _entriesBySession.delete(id); }
  });
}

function _renderGrid() {
  const grid = document.getElementById("sessions-grid");
  const idle = document.getElementById("idle-screen");
  if (_visible.length === 0) {
    idle.style.display = "";
    grid.style.display = "none";
    grid.innerHTML = "";
    return;
  }
  idle.style.display = "none";
  grid.style.display = "grid";
  grid.innerHTML = _visible.map((s) => (_isFinished(s) ? _resultsPanelHtml(s) : _livePanelHtml(s))).join("");
  _tickAllTimers();
}

/** Ended, or still marked live but well past its deadline (results show without waiting). */
function _isFinished(s) {
  return s.status === "ended" || (s.status === "live" && s.deadline && Date.now() > s.deadline.toMillis() + 8000);
}

function _livePanelHtml(session) {
  const entries = _entriesBySession.get(session.id) || [];
  const ranked = computeRanks(entries.map((e) => ({ ...e, percentage: e.percentage || 0 })));
  ranked.sort((a, b) => a.rank - b.rank);
  const maxRank = ranked.length ? Math.max(...ranked.map((r) => r.rank)) : 0;

  const rows = ranked.map((r) => {
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
  }).join("");

  return `
    <div class="session-panel">
      <div class="panel-header">
        <h2>${escapeHtml(session.subjectName)}</h2>
        <div class="panel-timer" data-timer-for="${session.id}">--:--</div>
      </div>
      ${rows || '<p class="empty-hint">Waiting for students…</p>'}
    </div>`;
}

function _resultsPanelHtml(session) {
  const entries = _entriesBySession.get(session.id) || [];
  const ranked = computeRanks(entries.map((e) => ({ ...e, percentage: e.percentage || 0 })));
  ranked.sort((a, b) => a.rank - b.rank || (a.name || "").localeCompare(b.name || ""));

  // How many students share each position (standard competition ranking: 1, 1, 3 ...)
  const sharing = {};
  ranked.forEach((r) => { sharing[r.rank] = (sharing[r.rank] || 0) + 1; });

  // One grid, four students per row, ordered by position. Every card names its position;
  // students who tie carry the same position, marked as a tie.
  const cards = ranked.map((st) => {
    const tie = sharing[st.rank] > 1;
    const label = `${positionWord(st.rank)} position${tie ? " is a tie" : ""}`;
    return `
      <div class="result-card ${st.rank === 1 ? "result-card-first" : ""}">
        <div class="result-position">${st.rank === 1 ? "🏆 " : ""}${label}</div>
        ${avatarImgHtml(st, st.rank === 1 ? 104 : 84)}
        <div class="result-name">${escapeHtml(st.name)}</div>
        <div class="result-score">${st.percentage || 0}%</div>
      </div>`;
  }).join("");

  return `
    <div class="session-panel results-panel">
      <div class="panel-header">
        <h2>${escapeHtml(session.subjectName)} — Final results</h2>
      </div>
      <div class="results-grid">${cards || '<p class="empty-hint">No results to show.</p>'}</div>
    </div>`;
}

function _tickAllTimers() {
  document.querySelectorAll("[data-timer-for]").forEach((el) => {
    const s = _visible.find((x) => x.id === el.dataset.timerFor);
    if (s && s.status === "live" && s.deadline) {
      el.textContent = formatDuration(Math.max(0, Math.round((s.deadline.toMillis() - Date.now()) / 1000)));
    }
  });
}

let _displayInitialized = false;
ensureDisplaySignedIn(() => {
  if (_displayInitialized) return;
  _displayInitialized = true;
  initDisplay();
});