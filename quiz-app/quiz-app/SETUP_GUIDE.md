# Classroom Quiz — Setup Guide

This covers only what's **not already done** in your Firebase project. You said Firestore, Email/Password + Anonymous Auth, and your admin account are already set up — so this is just: paste in the Security Rules, and deploy the static files. No command line needed anywhere in this guide.

---

## 1. Paste in the Firestore Security Rules

1. Go to the [Firebase Console](https://console.firebase.google.com/) → your **shool-quiz** project.
2. In the left sidebar, open **Firestore Database**.
3. Click the **Rules** tab at the top.
4. Select all the existing text in the editor and delete it.
5. Open the file **`firestore.rules`** from this project, copy its entire contents, and paste it into the console editor.
6. Click **Publish**.

That's it — no other Firestore configuration is needed. Because every query in this app filters on a single field only (see "Why some things are built the way they are" below), you do **not** need to create any composite indexes in the **Indexes** tab.

---

## 2. Deploy the static files to Netlify

You said you'll handle Netlify yourself, so briefly:

1. Log into [Netlify](https://app.netlify.com/).
2. Drag the whole project folder (the one containing `index.html` and the `admin`, `student`, `display`, and `shared` folders) onto Netlify's "Deploy manually" drop zone — or connect it via Git if you prefer.
3. **Important:** don't set a "publish directory" other than the project root — everything references its siblings with relative paths, so all the folders need to stay exactly where they are relative to each other.
4. Once deployed:
   - `https://yoursite.netlify.app/` — a landing page with three buttons (Teacher / Student / Display) linking to the views below. Handy to bookmark or hand out as the one link people need.
   - `https://yoursite.netlify.app/admin/`
   - `https://yoursite.netlify.app/student/`
   - `https://yoursite.netlify.app/display/`

No environment variables, build command, or Node.js is needed — every file runs as-is.

---

## 3. Add your Firebase domain to the authorized list

1. Firebase Console → **Authentication** → **Settings** tab → **Authorized domains**.
2. Click **Add domain** and add your Netlify domain (e.g. `yoursite.netlify.app`).
3. This is required for `signInWithEmailAndPassword` and anonymous sign-in to work from your deployed site — without it, logins will fail with a domain-not-authorized error.

---

## 4. Try it out

1. Open `/admin/`, log in with your existing admin email/password.
2. Add a subject (try a "General" one first — e.g. "Geography") and a couple of questions.
3. Add 2 students to the roster — write down the passwords you set.
4. Create a session, select your subject, a short timer (try 2 minutes first), and your 2 students.
5. Open `/student/` in another browser (or a private/incognito window) and log in as one of the students.
6. Open `/display/` in a third tab/window — leave it open, it needs no login.
7. Back in `/admin/`, click **Start**. Watch the student's timer start, answer a question, and watch the Display view update live.

---

## What these Security Rules do — and don't — protect against

You asked for this to be explained clearly, so here it is straight:

### Fully protected (enforced by the Security Rules, not just app code)

- **Only your admin account** can create/edit/delete subjects, questions, the student roster, and sessions. No one else can write to these, no matter what they do in devtools.
- **A student can only read and write their own data.** They cannot read another student's typed answers or accepted-answers list.
- **A question can only be answered once.** The rules physically reject any attempt to modify an already-submitted answer, even by directly calling the Firestore API from the browser console.
- **Submissions are only accepted while the session is live and before its deadline** — checked against Firestore's own clock, never the student's device clock. A student changing their computer's clock cannot extend their time.
- **Grade tampering is impossible.** When a student submits an answer, the rules independently recompute whether it's correct from the accepted-answers list already stored on that same document — a student cannot send a fabricated "this was correct" result for a wrong answer. This is why the admin's CSV/PDF exports and History view always recompute scores from this same tamper-proof record, not from the live leaderboard's convenience numbers (see below).

### A deliberate, documented trade-off (not fully closeable without a paid backend)

- **A student can look ahead at their current question's accepted answers using their browser's developer tools**, since grading has to happen in the browser — there's no server on the free Spark plan to hide that logic behind. This is a real limitation of doing serverless grading, and there's no way around it without adding Cloud Functions (a paid-tier feature). In practice, this only lets a student see the answer to the *one question currently open in front of them* a few seconds early — it does not let them see other students' answers, change their own recorded grade, or affect anyone else's session.
- **The live, in-progress leaderboard percentage is a convenience value**, written by the student's own browser as they go, for a responsive-feeling Display screen. It is *not* used for anything official. The moment you export a CSV/PDF or view History, the app throws that number away and recomputes each student's real score fresh from the tamper-proof per-question records described above. So even in the unlikely case a student found a way to make their live in-progress number look better mid-quiz, it would have zero effect on their real, recorded, exported grade.
- **Student login passwords are stored in Firestore** (not just in Firebase Auth) — as plain text, readable only by your admin account and by that one student themselves (never by other students). This isn't how you'd do it with a real backend, but it's what makes "change a student's password with one click, no email flow" possible at all with no server — the admin's browser needs to look up the current password to briefly sign in as that student and change it. If this ever feels like too much for your situation, the safer alternative would be moving to Cloud Functions and the Admin SDK on a paid Firebase plan — but that's outside what you asked for here.

---

## Why some things are built the way they are

A few choices in this codebase might look unusual — they're deliberate, based on real bugs hit while building a similar app before:

- **Every Firestore query filters on exactly one field**, with any additional sorting/filtering done in JavaScript after the data comes back. Combining a `where()` on one field with `orderBy()` on a *different* field (or certain combinations of two filters) can silently require a manually-created index in the Firebase console — and until that index exists, the query just fails with no visible error to the user. Avoiding the combination entirely sidesteps this class of bug completely, and is why you don't need to visit the **Indexes** tab in Firebase at all.
- **The admin, student, and display views each use their own separately-named Firebase "app" instance** (`initializeApp(config, "admin")`, `"student"`, `"display"`). Firebase Auth's login session is normally shared across your whole domain, not per-page — so without this, logging into one view in one browser tab could silently log you out of another view open in a different tab of the same browser. Each view now has its own isolated login slot.
- **Every real-time listener has an error handler** that logs details to the browser console and shows a plain-English message on screen, instead of failing silently.
- **No raw Firebase/technical error ever reaches the screen.** Every error goes through one shared translation function first.
- **Session status and deadline are copied directly onto every student's own records** whenever you Start/Pause/Reset/End a session, instead of the Security Rules having to look up the parent session document every time a student submits an answer. This keeps the rule that checks "is this session still active?" simple, fast, and unambiguous.

---

## A note on Pause vs. Reset vs. Clear History vs. End vs. Delete

Since these are easy to mix up:

| Action | What happens to the timer | What happens to already-submitted answers |
|---|---|---|
| **Pause** | Freezes exactly where it is. Resumes from that exact point when you click Start again. | Untouched. |
| **Reset** | Whatever question each student currently has open gets auto-submitted as-is (like a timeout), then the timer goes back to the full original duration, ready to Start again. | Answers submitted *before* the reset stay locked in as they were. |
| **Clear history** | Not affected — only available when the session isn't currently live. | Wiped to zero for every student in this session, who are also freshly re-shuffled. |
| **End** | Session becomes read-only history. | Whatever's currently open gets auto-submitted first, same as Reset. |
| **Delete** (only available on an ended session) | — | Permanently deletes the session and everyone's results in it. Cannot be undone. |

---

## Optional enhancements not built (see the end of the main chat reply for the full list)

This guide covers everything needed to run what was built. A list of things intentionally left out of scope is provided separately so you can ask for any of them later if you want them.
