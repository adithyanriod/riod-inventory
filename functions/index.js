// Riod Inventory — server functions (Firebase Cloud Functions, 2nd gen).
// Deploy with:  firebase deploy --only functions
//
// adminSetPassword: lets the admin set a new password for an engineer.
// Browsers cannot change another user's password, so this runs on Google's servers with the Admin SDK.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();

// Must match ADMIN_EMAIL in js/firebase-config.js and firestore.rules.
const ADMIN_EMAIL = 'adithyan@riodlogic.com';

exports.adminSetPassword = onCall({ region: 'asia-south1' }, async (req) => {
  const callerEmail = String(req.auth?.token?.email || '').toLowerCase();
  if (!req.auth || callerEmail !== ADMIN_EMAIL) {
    throw new HttpsError('permission-denied', 'Only the admin can set passwords.');
  }

  const { uid, password } = req.data || {};
  if (typeof uid !== 'string' || !uid) throw new HttpsError('invalid-argument', 'Missing engineer.');
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
    throw new HttpsError('invalid-argument', 'Password must be 6 to 128 characters.');
  }

  const ref = getFirestore().doc(`users/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'This engineer does not exist.');
  if (snap.data().role === 'admin' || uid === req.auth.uid) {
    throw new HttpsError('failed-precondition', 'Use "Change password" in your own menu for the admin account.');
  }

  await getAuth().updateUser(uid, { password });
  // Sign the engineer out everywhere, so the old password/session stops working.
  await getAuth().revokeRefreshTokens(uid);
  await ref.update({ passwordSetAt: FieldValue.serverTimestamp(), passwordSetBy: req.auth.uid });
  return { ok: true };
});
