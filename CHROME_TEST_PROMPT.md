# GearOps Production Test — Claude in Chrome Prompt

Copy everything inside the triple-backtick block and paste it as your Claude in Chrome prompt.
Replace [INSERT TEST EMAIL] and [INSERT TEST PASSWORD] before running.

---

```
You are a senior QA engineer performing a thorough exploratory test of a production web application called GearOps — an asset management platform for Engineering Surveys Pty Ltd.

Production URL: https://gearops.com.au
API base: https://api.gearops.com.au

Your job is to navigate the app systematically, interact with every major feature, capture all errors and issues, and produce a structured bug/improvement report at the end. Do NOT stop until you have tested every section listed below.

---

## CREDENTIALS
Use these test credentials to log in:
  Email:    [INSERT TEST EMAIL]
  Password: [INSERT TEST PASSWORD]

If login fails, note the exact error and skip authenticated sections — still test the public pages.

---

## WHAT TO CHECK ON EVERY PAGE
Before leaving each page, capture:
- Visual/layout issues (broken images, cut-off text, misaligned items, overlapping elements)
- Console errors  →  DevTools → Console tab (keep it open the whole time)
- Network errors  →  DevTools → Network tab (red 4xx/5xx requests)
- Missing UX feedback (no loading spinners, no empty states, no error messages)
- Pages that take >3 seconds to load
- Layout at 375px width (simulate mobile by resizing the browser window)

---

### SECTION 1 — AUTH & ONBOARDING
1. Navigate to https://gearops.com.au
2. Note the landing/splash screen. Any flash of unstyled content or stuck loading?
3. Navigate to /login. Check form layout, placeholder text, button labels.
4. Submit with empty fields — does validation fire?
5. Submit with a wrong password — is the error message clear and human-readable?
6. Log in with the test credentials. Note how long the redirect takes.
7. Confirm you land on the Dashboard after login.

---

### SECTION 2 — DASHBOARD
1. Check all widgets: asset stats, quick-action buttons, recent activity feed.
2. Confirm stat numbers are loaded (not stuck on 0 or blank).
3. Click each Quick Action shortcut — does it navigate correctly?
4. Scroll through the Recent Activity feed. Check timestamps, action labels, user names.
5. Resize to 375px — check mobile card layout.
6. Note any console errors on this page.

---

### SECTION 3 — INVENTORY (Asset List)
1. Navigate to Inventory/Assets.
2. Confirm the list loads. Note approximately how many assets are visible.
3. Test the search input: type a partial asset ID or name. Does it filter live?
4. Test the status filter dropdown (Available, In Use, Maintenance, Retired).
5. Click any asset to open its detail page.
6. On the asset detail, check all tabs: Specs, Documents, Activity/History, Actions.
7. Check if any tab shows a spinner forever or a console error.
8. Try the "Check In" or "Check Out" button — does the action modal open?
9. Go back and test pagination if more than one page of assets exists.
10. Resize to 375px — mobile card layout check.

---

### SECTION 4 — ASSET CREATION
1. Click "New Asset" or "Add Asset".
2. Check all fields are present: Asset ID, Name, Type, Status, Location, Serial Number, image upload.
3. Submit blank — do required field validations fire?
4. Fill minimum required fields and submit. Does it create successfully?
5. After creation, confirm redirect to the new asset's detail page.
6. Note any console errors during creation.

---

### SECTION 5 — ASSET TYPES
1. Navigate to Asset Types (Admin or Settings area).
2. Check the list loads with names and images. Note any broken images (404).
3. Click one type — confirm custom fields are listed.

---

### SECTION 6 — TASKS & HIRE
1. Navigate to the Tasks tab or Hire section.
2. Confirm the hire list loads with status badges: Pending Signature, Signed, Declined, Expired.
3. Click a hire row to expand or view details.
4. Find the "Send via Email" button and the "Generate PDF & Sign" button. Confirm both are visible and not greyed out.
5. Click "Generate PDF & Sign" — a new browser tab should open with the signing page.
6. On the signing page: confirm the PDF renders in the iframe, the signature canvas is visible, and Submit/Decline buttons are present.
7. Try drawing a signature on the canvas with the mouse. Does it draw smoothly?
8. Resize the signing page to 375px — is the signature canvas usable on mobile?
9. Note any console errors in this section.

---

### SECTION 7 — HIRE AGREEMENT PDF
1. Go to an existing hire record and click "Preview PDF" or the document icon.
2. Does the PDF open inline or download?
3. Check PDF content: title "Equipment Lease Agreement", sections Lease Summary, Equipment Details, Insurance and Responsibility, Acceptance and Signatures, Disclaimer of Liability (21 clauses).
4. Confirm hire data fields (name, dates, equipment, rate) are filled in — no [placeholder] text visible.
5. Note any rendering issues (garbled text, missing sections).

---

### SECTION 8 — QR & PUBLIC CHECK-IN
1. Navigate to https://gearops.com.au/check-in/public or find the public check-in URL for any asset.
2. Confirm the page loads without authentication.
3. Check: asset name, action buttons (Lost & Found, Transfer to Office) are visible.
4. Navigate to the QR Scanner tab (if accessible in web).
5. Does the camera permission prompt appear?

---

### SECTION 9 — SEARCH
1. Navigate to the Search page or use the global search bar.
2. Type 3 characters — do live results or autocomplete appear?
3. Press Enter — do results load?
4. Filter by asset type or status.
5. Click a result — does it navigate to the correct asset detail?

---

### SECTION 10 — ACTIVITY FEED
1. Navigate to the Activity / Timeline page.
2. Check events show: asset name, action type, user name, timestamp.
3. Scroll — does infinite scroll or pagination work?
4. Confirm action labels are human-readable ("Checked In" not "CHECK_IN").
5. Confirm timestamps are in Australian time (AEST/AEDT), not UTC.

---

### SECTION 11 — ADMIN PANEL
1. Navigate to Admin panel.
2. Users tab: confirm list loads with name, email, role, and status chips.
3. Click "Invite User" — does the modal open with an email field?
4. Check the QR Code generation tab — does the form load?
5. Check Domain Management tab.
6. If the test account is not admin, confirm a clear "Access Denied" message shows (not a white screen or 500 error).

---

### SECTION 12 — PROFILE
1. Navigate to Profile page.
2. Check: display name, email, role badge, profile image.
3. Try editing the display name — does the save button work?
4. Note any console errors.

---

### SECTION 13 — NAVIGATION & RESPONSIVENESS
1. At 1280px+ width: confirm top nav bar shows all tabs with text labels.
2. At 768px: check nav adapts for tablet (no overflow, no hidden items).
3. At 375px: confirm hamburger menu or bottom tab bar appears and is functional.
4. Click every nav item — confirm correct page loads with no white-screen crash.

---

### SECTION 14 — NETWORK & PERFORMANCE AUDIT
1. Open DevTools → Network tab, reload the Dashboard.
2. List any API calls returning 4xx or 5xx status codes.
3. List any API calls taking longer than 2 seconds.
4. Check for any requests going to localhost or 127.0.0.1 (none should in production).
5. Check if API responses use gzip compression (Content-Encoding: gzip header).
6. List any failed image or document loads (broken S3 URLs).

---

### SECTION 15 — CONSOLE ERRORS SWEEP
1. Clear the DevTools Console.
2. Navigate through: Dashboard → Asset List → One Asset Detail → Tasks → Activity → Admin → Profile.
3. List every unique error or warning in the console, noting which page it appeared on.
4. Flag especially: "Cannot read properties of undefined", "fetch failed", "401 Unauthorized", React key/prop warnings.

---

## FINAL REPORT

After completing all 15 sections, produce this exact report:

---

# GearOps Production QA Report
**Tested:** [date and time you ran the test]
**Tester:** Claude in Chrome
**Environment:** Production — https://gearops.com.au

## CRITICAL BUGS  (app-breaking, data loss, auth failures)
| # | Page | Issue | Steps to Reproduce | Error Observed |
|---|------|-------|--------------------|----------------|

## HIGH BUGS  (feature broken, wrong data shown, flow fails)
| # | Page | Issue | Steps to Reproduce | Error Observed |
|---|------|-------|--------------------|----------------|

## MEDIUM BUGS  (visual broken, missing feedback, partial failure)
| # | Page | Issue | Steps to Reproduce | Error Observed |
|---|------|-------|--------------------|----------------|

## LOW / POLISH  (UI nitpicks, copy errors, minor UX issues)
| # | Page | Issue | Suggestion |
|---|------|-------|-----------|

## PERFORMANCE ISSUES
| # | Page or Endpoint | Issue | Load Time Observed |
|---|-----------------|-------|--------------------|

## MOBILE RESPONSIVENESS (375px viewport)
| # | Page | Issue |
|---|------|-------|

## NETWORK / API ISSUES
| # | Endpoint | Status | Notes |
|---|---------|--------|-------|

## CONSOLE ERRORS
| # | Page | Error Message |
|---|------|--------------|

## UX IMPROVEMENT SUGGESTIONS
| # | Area | Current Behaviour | Suggested Improvement |
|---|------|------------------|-----------------------|

## SUMMARY
- **Total issues:** X  (Critical: X, High: X, Medium: X, Low: X)
- **Pages with console errors:** [list]
- **Biggest risk:** [one sentence]
- **Top 3 recommended fixes in priority order:**
  1. ...
  2. ...
  3. ...

---

Do not skip any section. If a feature is inaccessible (not admin, camera not available, etc.), note it and continue. Start now with Section 1.
```

---

## How to use this prompt

1. Open **Claude in Chrome** inside the Claude desktop app.
2. Make sure it is connected to an active Chrome window.
3. Replace `[INSERT TEST EMAIL]` and `[INSERT TEST PASSWORD]` with real test credentials.
4. Paste the full prompt (inside the triple backticks) as your message to Claude in Chrome.
5. Run it with an **admin account** so the Admin Panel section can be fully tested.
6. Let it run end-to-end — it will work through all 15 sections automatically.

> The final report will be formatted as tables you can paste directly into a Notion doc, GitHub issue, or share with the team.
