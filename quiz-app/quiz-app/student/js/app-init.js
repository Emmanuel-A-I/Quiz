/**
 * Student view Firebase bootstrap.
 * [LESSON 2] Its own separately-named Firebase App instance ("student"),
 * isolated from the admin and display views' login sessions.
 */
const studentApp = firebase.initializeApp(FIREBASE_CONFIG, "student");
const studentAuth = studentApp.auth();
const studentDb = studentApp.firestore();

studentAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((e) => console.error(e));
