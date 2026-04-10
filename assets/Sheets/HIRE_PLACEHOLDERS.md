# Equipment Hire Lease – Template placeholders

Use a **.docx** template (Word 2007+).

**Improve template layout:** From the project root run  
`node inventory-api/scripts/improve-lease-template.js`  
to center the title, add spacing between sections, and bold field labels. A backup is saved as `Equipment hire lease disclaimer_backup.docx`. Docxtemplater does not support `.doc`; if you have a `.doc` file, open it in Word and **Save As → Word Document (.docx)**.

**Remove dotted lines:** Run  
`node inventory-api/scripts/remove-dotted-lines.js`  
to remove dotted placeholder lines from the template (tab leaders are set to “none” so dotted lines no longer appear; any runs that are only dots/spaces are removed).

**Lease summary layout & section order:** The stock template `Equipment hire lease disclaimer.docx` uses a **four-column** lease summary on most rows (label | value | label | value). Row 1 is **Contact Person** | `[name]` | **Company / Entity or Project** | `[companyEntity]` and `[project]` (line break between; usually one is filled). **Contact Number** and **Address** use a full-width value cell. Document order is: **Lease summary → Equipment details → Disclaimer of Liability and Additional Terms → Insurance and Responsibility → Acceptance and Signatures**. To re-apply this structure after manual edits, run from the project root:  
`node scripts/patch-hire-lease-docx.js`

## Lessee signature status (hire dashboard)

Each hire row stores `signatureStatus` on `asset_actions.data`:

- **`pending_signature`** — default when a hire is created from the form; shown as **Pending signature** in the app.
- **`signed`** — set when the lessee completes e-sign (DocuSign, Adobe Sign, etc.); shown as **Signed**.

**Update from your backend / webhook** (after you integrate an e-sign provider):

```http
PATCH /hire-disclaimer/hires/:actionId/signature-status
Content-Type: application/json

{ "status": "signed", "signedAt": "2026-02-12T10:00:00.000Z" }
```

Optional: `{ "status": "pending_signature" }` clears `signedAt`. Protect this route in production (API key / auth).

### DocuSign

The app can send the lease for e-signature via **DocuSign** (email or embedded tab). When the envelope completes, **DocuSign Connect** calls the webhook and sets status to **Signed**. Setup: **`inventory-api/docs/DOCUSIGN.md`**. Add anchor text **`/sign_lease/`** to the Word template at the lessee signature line (see that doc).

## Where to put the template

Place the template in one of these locations with one of these names:

- `assets/Sheets/Equipment hire lease disclaimer.docx`
- `assets/Sheets/Equipment hire lease disclaimer .docx` (with space before .docx)
- `assets/Sheets/Equipment_hire_lease_disclaimer.docx`

## Placeholders in the Word document

In the template, use **curly braces** `{placeholderName}`. The app replaces them with form data when the user clicks “Generate & download .docx”.

### Main placeholders (match [brackets] in your text)

| In your text   | In the template      | Filled from form / computed                                                                                                        |
| -------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [address]      | `{address}`          | Address of company/entity/person                                                                                                   |
| [name]         | `{name}`             | Contact person (name)                                                                                                              |
| [number]       | `{number}`           | Contact Number                                                                                                                     |
| [startdate]    | `{startdate}`        | Start date (e.g. 04 March 2026)                                                                                                    |
| [starttime]    | `{starttime}`        | Pickup time (optional on form; same as `{pickupTime}`)                                                                             |
| [days]         | `{days}`             | **Inclusive** hire days from start date through return date (e.g. 1–7 Mar → 7)                                                     |
| [enddate]      | `{enddate}`          | Return date (item to be returned)                                                                                                  |
| Company/Entity | `{companyEntity}`    | Optional; **Company / Entity** field — type to search **Algolia `clients`** index or type manually                                 |
| Project        | `{project}`          | Optional; **Project** field — type to search **Algolia `projects`** index or type manually (same setup as `ActionsForm` hire flow) |
| [cost]         | `{cost}`             | Rate **amount** only (number as entered; not “per day” by itself)                                                                  |
| Rate + period  | `{rateLine}`         | e.g. `150 per week` — amount + `per day` / `per week` / `per month`                                                                |
|                | `{ratePeriodPhrase}` | `per day`, `per week`, or `per month` (use after `$[cost]` in Word if needed)                                                      |
|                | `{ratePeriod}`       | `day`, `week`, or `month` (machine value)                                                                                          |
| [asset type]   | `{assetType}`        | Equipment type(s) (e.g. Total station, GPS, Laptop)                                                                                |
| [serial]       | `{serial}`           | Serial number(s), comma-separated                                                                                                  |
| [todaysdate]   | `{todaysdate}`       | Signature date / today’s date (e.g. 12 February 2026)                                                                              |

### Lessor / Lessee

| Placeholder    | Value                             |
| -------------- | --------------------------------- |
| `{lessor}`     | Always **Engineering Surveys**    |
| `{lesseeName}` | Signed by lessee (name from form) |

### Other placeholders (still supported)

| Placeholder          | Meaning                                                         |
| -------------------- | --------------------------------------------------------------- |
| `{hirerName}`        | Same as `{name}` (Contact Pickup Name)                          |
| `{phone}`            | Same as `{number}`                                              |
| `{hireStartDate}`    | Start date (raw)                                                |
| `{hireStartTime}`    | Pickup time                                                     |
| `{pickupTime}`       | Same as `{hireStartTime}`                                       |
| `{hireEndDate}`      | Return date (raw)                                               |
| `{hireEndTime}`      | End time (optional; usually empty — form uses return date only) |
| `{startDateTime}`    | Start date and pickup time in one line                          |
| `{endDateTime}`      | Return date (and end time if provided) in one line              |
| `{rate}`             | Same as `{cost}` (numeric amount)                               |
| `{rateLine}`         | Amount + period phrase (e.g. `200 per month`)                   |
| `{ratePeriodPhrase}` | `per day` / `per week` / `per month`                            |
| `{ratePeriod}`       | `day` / `week` / `month`                                        |
| `{signatureName}`    | Signed by (name)                                                |
| `{signatureDate}`    | Signature date                                                  |
| `{equipmentList}`    | Full equipment list as one block of text                        |
| `{generatedOn}`      | Timestamp when the document was generated                       |

## Example template text

Use curly braces in Word, for example:

```
This equipment lease is made and effective by and between, Engineering Surveys and :

Address of company/ entity/ person: {address}

Contact Pickup (Name): {name}
Contact Number: {number}

Terms of lease will commence as of :
Date: {startdate}  Pickup time: {starttime}
Hire period (days, inclusive): {days}
Date item to be returned: {enddate}

Company / Entity: {companyEntity}   (empty if Project was selected)
Project: {project}                   (empty if Company/Entity was selected)

Item to be leased at a cost of $.{cost} {ratePeriodPhrase}   (or use $.{rateLine} without extra “per day” text)

Lessor hereby leases to Lessee, and Lessee hereby leases from Lessor, the following
List equipment including any individual items eg. Batteries, charger, multi prisms etc: {assetType}
Serial number(s): {serial}

...

This contract is accepted by Engineering surveys on this date: {todaysdate}
Signed by lessee: {lesseeName}
Dated: {todaysdate}
Signed by lessor [engineering surveys]: {lessor}
Dated: {todaysdate}
```

## Download filename

The generated file is downloaded as: **Equipment hire lease\_&lt;Contact Name&gt;.docx**  
Example: `Equipment hire lease_shivam.docx` (using the Contact Pickup name from the form).

## Equipment list (repeating rows)

To repeat a block per equipment item in the template, use:

```
{#equipmentItems}
Asset/Serial: {assetId}
Equipment type: {description}
{/equipmentItems}
```

If no equipment items were added, the app still sends one row so the loop runs once.
