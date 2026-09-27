/**
 * Student app entry point.
 */
let _studentInitialized = false;

initStudentAuth((user, studentRecord) => {
  initStudentProfile(studentRecord);
  if (!_studentInitialized) {
    initStudentQuiz(user.uid);
    _studentInitialized = true;
  }
});
