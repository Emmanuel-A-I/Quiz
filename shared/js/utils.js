/**
 * Shared utilities used across admin, student, and display views.
 */

/** Fisher–Yates shuffle. Returns a NEW array, does not mutate input. */
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Splits a comma-separated accepted-answers string into trimmed, non-empty entries. */
function parseAcceptedAnswers(raw) {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Lowercases + trims a list of accepted answers, for storage/rule-matching. */
function toLowerList(list) {
  return (list || []).map((s) => s.trim().toLowerCase());
}

/**
 * Client-side preview of whether a typed answer would be judged correct.
 * The ACTUAL authoritative check happens in Firestore Security Rules using
 * the same logic (case-insensitive, exact match against any accepted answer,
 * no fuzzy/typo tolerance). This is used for immediate UI feedback only.
 */
function isAnswerCorrect(typedAnswer, acceptedAnswersLower) {
  const t = (typedAnswer || "").trim().toLowerCase();
  return acceptedAnswersLower.includes(t);
}

/** Warns if a question's text contains one of its own accepted answers (spelling-test safeguard). */
function questionLeaksAnswer(questionText, acceptedAnswers) {
  const q = (questionText || "").toLowerCase();
  return (acceptedAnswers || []).some((a) => a.trim().length > 0 && q.includes(a.trim().toLowerCase()));
}

/** Formats seconds as M:SS or H:MM:SS. */
function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Formats a Firestore Timestamp (or Date) as a friendly local date+time string. */
function formatDateTime(tsOrDate) {
  if (!tsOrDate) return "—";
  const d = typeof tsOrDate.toDate === "function" ? tsOrDate.toDate() : new Date(tsOrDate);
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Resizes + compresses an image file in the browser (canvas), returning a
 * base64 JPEG data URI. Keeps Firestore documents small (no Storage on Spark).
 */
function compressImageToDataUri(file, maxDim = 380, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Please choose an image file."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Couldn't read that image."));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const dataUri = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUri);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/** Ranks a list of {studentId, percentage} descending, standard competition ranking (1,1,3). */
function computeRanks(entries) {
  const sorted = entries.slice().sort((a, b) => b.percentage - a.percentage);
  let rank = 0;
  let lastScore = null;
  let seen = 0;
  return sorted.map((e) => {
    seen++;
    if (e.percentage !== lastScore) {
      rank = seen;
      lastScore = e.percentage;
    }
    return { ...e, rank };
  });
}

/** Triggers a browser download of a text blob. */
function downloadTextFile(filename, text, mime = "text/csv;charset=utf-8;") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Escapes a value for safe inclusion in a CSV cell. */
function csvCell(val) {
  const s = val === null || val === undefined ? "" : String(val);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function csvRow(values) {
  return values.map(csvCell).join(",") + "\r\n";
}

/** Debounce helper. */
function debounce(fn, wait = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/** Simple query-param helper. */
function qparam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/**
 * A subject is a "Spelling Bee" ONLY when its name is exactly "Spelling Bee"
 * (case-insensitive, extra spaces ignored). Every other subject name is a
 * normal subject.
 */
function isSpellingBeeName(name) {
  return (name || "").trim().replace(/\s+/g, " ").toLowerCase() === "spelling bee";
}

/** Sorts question-like docs by createdAt (oldest first) so word/question order is stable. */
function sortByCreated(list) {
  return list.slice().sort((a, b) => {
    const as = a.createdAt ? a.createdAt.seconds : Number.MAX_SAFE_INTEGER;
    const bs = b.createdAt ? b.createdAt.seconds : Number.MAX_SAFE_INTEGER;
    if (as !== bs) return as - bs;
    return (a.createdAt ? a.createdAt.nanoseconds : 0) - (b.createdAt ? b.createdAt.nanoseconds : 0);
  });
}

/** 1 -> "First", 2 -> "Second" ... used for result positions. */
function positionWord(n) {
  const words = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];
  return words[n - 1] || `${n}th`;
}

/* ==========================================================================
   Smart answer matching (used for every subject EXCEPT Spelling Bee)
   --------------------------------------------------------------------------
   A rules-based similarity check that runs in the browser — no external AI
   service. It compares the KEY WORDS of the teacher's answer with the
   student's answer, so a student who words an answer differently still
   passes:
     - ignores capitals, punctuation and filler words (a, the, is, of, or…)
     - understands plurals / endings (name ~ names ~ naming)
     - forgives small typos in longer words (Nigera ~ Nigeria)
     - knows a few everyday synonyms (person ~ individual, place ~ location…)
     - extra words are fine ("a noun is a name of …")
     - numbers must match exactly, and a flipped meaning ("NOT …") fails
   ========================================================================== */

// Share of the teacher's key words the student must cover (0.9 = 90%).
const ANSWER_MATCH_THRESHOLD = 0.9;

const _STOPWORDS = new Set(("a an the of or and is are was were be been being am to in on at for by with as it its " +
  "this that these those which who whom called known i you we they he she them there here has have had do does did " +
  "can will would should may might also very just so then than if from into about means mean refers " +
  // titles/honorifics: shouldn't count against or for a name-based answer
  "mr mrs miss ms dr chief alhaji alhaja otunba engr prof sir madam hon senator president").split(" "));

const _NEGATIONS = new Set(["not", "no", "never", "none", "cannot", "cant", "dont", "doesnt", "isnt", "arent", "wont", "nor", "without"]);

const _NUMBER_WORDS = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8",
  nine: "9", ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16",
  seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20"
};

const _SYNONYM_GROUPS = [
  ["yes", "yeah", "yep", "correct", "true", "indeed", "affirmative", "right"],
  ["no", "nope", "false", "incorrect", "negative", "wrong"],
  ["person", "people", "human", "individual", "someone", "somebody"],
  ["place", "location", "site", "area"],
  ["thing", "object", "item"],
  ["big", "large", "huge", "enormous"],
  ["small", "little", "tiny"],
  ["begin", "start", "commence"],
  ["end", "finish", "conclude"],
  ["fast", "quick", "rapid", "speedy"],
  ["buy", "purchase"],
  ["kid", "child", "children"],
  ["car", "automobile", "vehicle"],
  ["shows", "displays", "indicates"],
  ["describes", "describe", "explains", "explain"],
];
const _SYNONYM_INDEX = new Map();
_SYNONYM_GROUPS.forEach((g, i) => g.forEach((w) => _SYNONYM_INDEX.set(w, i)));

function _tokenizeAnswer(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => _NUMBER_WORDS[w] || w);
}

/** Possible base forms of a word (handles plurals, -ing, -ed). */
function _stemCandidates(w) {
  const c = new Set([w]);
  if (/^\d+$/.test(w)) return c;
  if (w.length > 4 && w.endsWith("ies")) c.add(w.slice(0, -3) + "y");
  if (w.length > 3 && w.endsWith("es")) c.add(w.slice(0, -2));
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) c.add(w.slice(0, -1));
  if (w.length > 5 && w.endsWith("ing")) {
    const b = w.slice(0, -3);
    c.add(b); c.add(b + "e");
    if (b.length > 2 && b[b.length - 1] === b[b.length - 2]) c.add(b.slice(0, -1));
  }
  if (w.length > 4 && w.endsWith("ed")) {
    const b = w.slice(0, -2);
    c.add(b); c.add(w.slice(0, -1));
    if (b.length > 2 && b[b.length - 1] === b[b.length - 2]) c.add(b.slice(0, -1));
  }
  return c;
}

function _editDistance(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function _tokensMatch(a, b) {
  if (a === b) return true;
  const hasDigit = /\d/.test(a) || /\d/.test(b);
  if (hasDigit) return false; // numbers must match exactly
  const ca = _stemCandidates(a), cb = _stemCandidates(b);
  for (const x of ca) {
    if (cb.has(x)) return true;
    const gx = _SYNONYM_INDEX.get(x);
    if (gx !== undefined) for (const y of cb) if (_SYNONYM_INDEX.get(y) === gx) return true;
  }
  // small typos, only in longer words
  const minLen = Math.min(a.length, b.length);
  if (minLen >= 5) {
    const allowed = Math.max(a.length, b.length) >= 9 ? 2 : 1;
    if (_editDistance(a, b) <= allowed) return true;
  }
  return false;
}

/** 0..1 — how well `studentText` covers the key ideas of `teacherText`. */
function answerSimilarity(studentText, teacherText) {
  const sAll = _tokenizeAnswer(studentText);
  const tAll = _tokenizeAnswer(teacherText);
  if (sAll.length === 0 || tAll.length === 0) return 0;

  let T = tAll.filter((w) => !_STOPWORDS.has(w));
  let S = sAll.filter((w) => !_STOPWORDS.has(w));
  if (T.length === 0) { T = tAll; S = sAll; } // teacher answer is only small words: compare them all

  const used = new Set();
  let matched = 0;
  T.forEach((t) => {
    for (let i = 0; i < S.length; i++) {
      if (!used.has(i) && _tokensMatch(t, S[i])) { used.add(i); matched++; return; }
    }
  });

  const recall = matched / T.length;
  const precision = S.length ? used.size / S.length : 0;
  let score = recall * Math.min(1, precision / 0.35); // stops "keyword stuffing"

  const sNeg = sAll.some((w) => _NEGATIONS.has(w));
  const tNeg = tAll.some((w) => _NEGATIONS.has(w));
  if (sNeg !== tNeg) score *= 0.3; // flipped meaning

  return score;
}

/**
 * Decides whether a typed answer is accepted.
 *   mode "exact" → Spelling Bee: exact match, capitals ignored, nothing else.
 *   mode "smart" → every other subject: exact OR similar enough (see above).
 * acceptedList: the teacher's accepted answers (any case).
 */
function isAnswerAcceptable(typedAnswer, acceptedList, mode) {
  const typed = (typedAnswer || "").trim().toLowerCase();
  if (!typed) return false;
  const list = (acceptedList || []).map((a) => String(a).trim().toLowerCase()).filter(Boolean);
  if (list.includes(typed)) return true;
  if (mode !== "smart") return false;
  return list.some((a) => answerSimilarity(typed, a) >= ANSWER_MATCH_THRESHOLD);
}