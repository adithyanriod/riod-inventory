// =====================================================================
//  Riod Inventory — configuration
// =====================================================================
//  1. Create a Firebase project (see README.md, "Setup" section).
//  2. Firebase console -> Project settings -> Your apps -> Web app -> Config.
//  3. Paste the values below.
//
//  These values are NOT secret — Firebase web config is meant to be public.
//  Data is protected by the rules in firestore.rules.
// =====================================================================

export const firebaseConfig = {
  apiKey: "AIzaSyBTsu-NgINdUAwHXJyBZ3Ld0NPLR0qoaJU",
  authDomain: "riod-inventory.firebaseapp.com",
  projectId: "riod-inventory",
  storageBucket: "riod-inventory.firebasestorage.app",
  messagingSenderId: "882334493502",
  appId: "1:882334493502:web:ea30b8adcecf6a28b29a6f"
};

// Only emails ending with this domain can sign in.
export const COMPANY_DOMAIN = "riodlogic.com";

// The admin: works like a normal engineer and can also add / remove engineers.
// To change the admin, also change the same email in firestore.rules and re-publish the rules.
export const ADMIN_EMAIL = "adithyan@riodlogic.com";

// Items with quantity below this number (but more than 0) appear in "Low Stock".
export const LOW_STOCK_THRESHOLD = 3;
