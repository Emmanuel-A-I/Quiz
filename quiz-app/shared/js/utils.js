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
