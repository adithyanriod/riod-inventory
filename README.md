# Riod Inventory

Electronic component inventory for the Riod Logic R&D team.

- Sign in with a company email (`name@riodlogic.com`) only. Accounts are created by the admin.
- Add components by hand, or import a BOM / Excel file. A preview flags missing fields before anything is saved.
- Search everything with one box: part number, value (`10k`, `100nF`, `4k7`), size (`0402`, `0603`), description words (`buck`, `LDO`).
  Results show the remaining quantity, the engineer who holds the part, and the project.
- Separate sections for **New Components**, **Low Stock** (fewer than 3 pcs) and **Out of Stock**.
- **My Inventory** groups your parts by project.
- **Requests**: ask a teammate for parts. They approve the quantity, and their stock is deducted automatically.
  Owners can also **Mark taken** to record parts used.
- **Vendors**: the source is *Online* (site name) or a *Vendor*. Saved vendors pop up while you type.
- **Desktop notifications** when someone adds a component ("Arjun added 100 10k 0603, Resistor 10k 1%"),
  when someone requests your parts, and when your request is answered.
- **Admin** (`adithyan@riodlogic.com`) has every engineer feature, plus **Manage Engineers** to add and remove engineers.

## How it works (and the GitHub question)

```
 Engineer's browser ──► GitHub Pages (the website files: HTML/JS/CSS, free)
         │
         └──────────► Firebase (Google, free tier): logins + database + live updates
```

Engineers **never log into GitHub**. GitHub only hosts the website files. Engineers open the site link and
sign in with their `@riodlogic.com` email and the password the admin gave them. Accounts and inventory data
live in Firebase.

## Setup (one time, about 15 minutes)

### 1. Create the Firebase project
1. Go to <https://console.firebase.google.com> → **Add project** → name it e.g. `riod-inventory`
   (Google Analytics is not needed).
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable → Save.**
3. **Authentication → Users → Add user**: create your admin account **first**:
   email `adithyan@riodlogic.com` and a strong password.
4. **Build → Firestore Database → Create database** → choose a location close to you (e.g. `asia-south1` Mumbai)
   → **Start in production mode**.
5. **Firestore → Rules** tab → delete everything, paste the contents of [`firestore.rules`](firestore.rules) → **Publish**.
6. **Project settings (gear icon) → General → Your apps → Web (`</>`)** → register an app (no hosting needed)
   → copy the `firebaseConfig` values into [`js/firebase-config.js`](js/firebase-config.js).

### 2. Publish on GitHub Pages
1. Push this folder to a GitHub repository.
2. Repository → **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/ (root)` → Save.**
3. After about a minute the site is live at `https://<your-github-username>.github.io/<repo-name>/`.
4. Back in Firebase: **Authentication → Settings → Authorized domains → Add domain** → `<your-github-username>.github.io`.

### 3. First use
1. Open the site and sign in as `adithyan@riodlogic.com`.
2. **Manage Engineers → Add engineer**: enter the name and email. The app generates a temporary password.
   Click **Copy details** and send them to the engineer.
3. Engineers sign in, click **Enable desktop notifications**, and can change their password from the top-right menu.

## Importing a BOM / Excel file

- Supported formats: `.xlsx`, `.xls`, `.csv`. Use **Download Excel template** on the import page for a sample.
- **Add a separate column named `Stock Qty`.** The quantity is read **only** from that column.
  The BOM's per-board `Qty` / `Quantity` column is ignored.
- Mandatory columns: **Part Number, Value, Package/Size, Description, Stock Qty**.
  Optional: Manufacturer, Category, Designator (used to guess the category), Project, **Source**.
- **Source is per component.** Add a `Source` (or `Supplier` / `Vendor` / `Site`) column with where each part was
  bought, e.g. `Mouser`, `LCSC`, or a vendor's name. In the preview every row has its own **Online / Vendor** choice
  and source name, which you can edit. Saved vendors are recognised automatically, and new vendor names are added
  to the Vendors list (add their contact details there later). Columns like `Supplier Part Number` are ignored.
- Headers from KiCad / Altium exports are recognised automatically (`Manufacturer Part Number`, `MPN`, `Comment`,
  `Footprint`, …). KiCad footprints like `Resistor_SMD:R_0603_1608Metric` become `0603`.
- The preview marks missing fields in red. Fix them directly in the table, or they are skipped.
  If a part already exists in the same project of your inventory, its quantity is increased instead of duplicated.

## Notifications
Notifications use the browser's desktop notifications. The site must be open in a tab (it can be in the
background or minimised). Tip: pin the tab in Chrome/Edge so it is always open.

## Costs
The Firebase free (Spark) plan allows 50,000 database reads per day, which is plenty for a small R&D team.
GitHub Pages is free for public repositories. The code has no secrets: the Firebase web config is meant to be
public, and the data is protected by `firestore.rules` and the logins.

## Files
| File | Purpose |
|---|---|
| `index.html` | Page shell |
| `css/styles.css` | Styles (light and dark mode) |
| `js/firebase-config.js` | **Your Firebase settings, company domain, admin email, low-stock threshold** |
| `js/app.js` | Application logic |
| `js/bom.js` | Excel/BOM parsing and column detection |
| `firestore.rules` | Database security rules (paste into Firebase) |

## Removing an engineer
**Manage Engineers → Remove.** They can no longer sign in or read data, and their components stay in the
inventory under their name. **Reactivate** restores access.
