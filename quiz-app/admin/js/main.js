/**
 * Admin app entry point.
 */
let _adminInitialized = false;

function _showSection(name) {
  document.querySelectorAll(".page").forEach((p) => (p.style.display = "none"));
  document.getElementById(`section-${name}`).style.display = "block";
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.section === name));
  const titles = { overview: "Overview", subjects: "Subjects & questions", roster: "Student roster", sessions: "Live sessions", history: "Session history" };
  document.getElementById("topbar-title").textContent = titles[name] || "";
}

function _wireNav() {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => _showSection(btn.dataset.section));
  });
}

function _updateOverviewStats() {
  document.getElementById("stat-subjects").textContent = AdminState.subjects.length;
  document.getElementById("stat-students").textContent = `${AdminState.students.length} / ${MAX_STUDENTS}`;
  document.getElementById("stat-live").textContent = AdminState.sessions.filter((s) => s.status === "live" || s.status === "paused").length;
  document.getElementById("stat-history").textContent = AdminState.sessions.filter((s) => s.status === "ended").length;
}

document.addEventListener("admin:subjects-updated", _updateOverviewStats);
document.addEventListener("admin:students-updated", _updateOverviewStats);
document.addEventListener("admin:sessions-updated", _updateOverviewStats);

initAdminAuth((user) => {
  _wireNav();
  if (!_adminInitialized) {
    initSubjects();
    initRoster();
    initSessions();
    initHistory();
    _adminInitialized = true;
  }
});
