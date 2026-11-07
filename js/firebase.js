// Firebase initialisation (loaded from Google's CDN — no build step needed)
import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import * as A from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import * as F from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const isConfigured =
  !!firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('PASTE');

export let app = null, auth = null, db = null;

if (isConfigured) {
  app = initializeApp(firebaseConfig);
  auth = A.getAuth(app);
  try {
    // Local cache: faster reloads and fewer reads from the server.
    db = F.initializeFirestore(app, {
      localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() })
    });
  } catch (e) {
    console.warn('Persistent cache unavailable, using memory cache', e);
    db = F.getFirestore(app);
  }
}

// All SDK functions in one object
export const fb = { ...A, ...F };

// The admin creates engineer logins through a *second* Firebase app instance,
// so the admin stays signed in on the main one.
let secondaryAuth = null;
export async function createAuthUser(email, password) {
  if (!secondaryAuth) {
    const sApp = initializeApp(firebaseConfig, 'secondary');
    secondaryAuth = A.initializeAuth(sApp, { persistence: A.inMemoryPersistence });
  }
  const cred = await A.createUserWithEmailAndPassword(secondaryAuth, email, password);
  const uid = cred.user.uid;
  await A.signOut(secondaryAuth);
  return uid;
}
