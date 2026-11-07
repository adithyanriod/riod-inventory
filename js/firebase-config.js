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
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000"
};

// Only emails ending with this domain can sign in.
export const COMPANY_DOMAIN = "riodlogic.com";

// The admin account (can add / remove engineers).
export const ADMIN_EMAIL = "admin@riodlogic.com";

// Items with quantity below this number (but more than 0) appear in "Low Stock".
export const LOW_STOCK_THRESHOLD = 3;
