# Hire lease PDF preview (.docx → PDF)

`GET /hire-disclaimer/hires/:id/preview.pdf` builds the same filled **Equipment hire lease** `.docx` as the Word download, then converts it to **PDF** using **LibreOffice** in headless mode. Layout and wording match the Word document (subject to LibreOffice’s renderer).

## Requirements

1. Install [LibreOffice](https://www.libreoffice.org/) on the machine running `inventory-api`.
2. Ensure the **`soffice`** executable is available:
   - **Windows:** often  
     `C:\Program Files\LibreOffice\program\soffice.exe`  
     (auto-detected if not on `PATH`).
   - **macOS:** `/Applications/LibreOffice.app/Contents/MacOS/soffice`  
     (auto-detected).
   - **Linux:** `apt install libreoffice-writer` (or your distro’s package); `soffice` on `PATH`.

## Optional environment variables

| Variable | Purpose |
|----------|---------|
| `LIBREOFFICE_PATH` or `SOFFICE_PATH` | Full path to `soffice` / `soffice.exe` if not on `PATH`. |
| `LIBREOFFICE_CONVERT_TIMEOUT_MS` | Conversion timeout (default 120000 ms, max 300000). |

If conversion fails, the API responds with **503** and a JSON `error` message describing the failure and the hint above.

## Docker / servers

Install LibreOffice in the API image or run a sidecar with `soffice` and point `LIBREOFFICE_PATH` at it. Headless conversion needs a writable temp directory (`os.tmpdir()`).
