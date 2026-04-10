/**
 * Convert a .docx buffer to PDF using LibreOffice (headless).
 * Install: https://www.libreoffice.org/ — or `apt install libreoffice` / `choco install libreoffice`.
 * Set LIBREOFFICE_PATH (or SOFFICE_PATH) to soffice.exe / soffice if not on PATH.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function findLibreOfficeExecutable() {
  const envPath = process.env.LIBREOFFICE_PATH || process.env.SOFFICE_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  if (process.platform === 'darwin') {
    const mac = '/Applications/LibreOffice.app/Contents/MacOS/soffice';
    if (fs.existsSync(mac)) {
      return mac;
    }
  }

  if (process.platform === 'win32') {
    const winPaths = [
      'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
      'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    ];
    for (const p of winPaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
  }

  return 'soffice';
}

/**
 * @param {Buffer} docxBuffer
 * @returns {Buffer}
 */
function convertDocxBufferToPdf(docxBuffer) {
  if (!Buffer.isBuffer(docxBuffer) || docxBuffer.length === 0) {
    throw new Error('Invalid .docx buffer');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hire-docx-'));
  const id = crypto.randomBytes(8).toString('hex');
  const docxPath = path.join(tmpDir, `${id}.docx`);
  const expectedPdf = path.join(tmpDir, `${id}.pdf`);

  try {
    fs.writeFileSync(docxPath, docxBuffer);

    const exe = findLibreOfficeExecutable();
    const args = [
      '--headless',
      '--nologo',
      '--nofirststartwizard',
      '--norestore',
      '--convert-to',
      'pdf',
      '--outdir',
      tmpDir,
      docxPath,
    ];

    const timeoutMs = Math.min(
      Math.max(30000, Number(process.env.LIBREOFFICE_CONVERT_TIMEOUT_MS) || 120000),
      300000
    );

    const result = spawnSync(exe, args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
    });

    if (result.error) {
      if (result.error.code === 'ENOENT') {
        throw new Error(
          `LibreOffice (soffice) not found at "${exe}". Install LibreOffice or set LIBREOFFICE_PATH.`
        );
      }
      throw result.error;
    }

    if (result.status !== 0) {
      const msg = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
      throw new Error(
        msg || `LibreOffice exited with code ${result.status}. Is LibreOffice installed?`
      );
    }

    if (!fs.existsSync(expectedPdf)) {
      throw new Error('LibreOffice did not create a PDF file (check template and disk space).');
    }

    return fs.readFileSync(expectedPdf);
  } finally {
    try {
      if (fs.existsSync(tmpDir)) {
        for (const name of fs.readdirSync(tmpDir)) {
          try {
            fs.unlinkSync(path.join(tmpDir, name));
          } catch {
            /* ignore */
          }
        }
        fs.rmdirSync(tmpDir);
      }
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  findLibreOfficeExecutable,
  convertDocxBufferToPdf,
};
