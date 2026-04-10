/**
 * Removes dotted-line placeholder runs from the Equipment hire lease disclaimer template.
 * Run from project root: node inventory-api/scripts/remove-dotted-lines.js
 */
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const sheetsDir = path.resolve(__dirname, '..', '..', 'assets', 'Sheets');
const names = ['Equipment hire lease disclaimer .docx', 'Equipment hire lease disclaimer.docx'];
let templatePath = null;
for (const name of names) {
  const p = path.join(sheetsDir, name);
  if (fs.existsSync(p)) {
    templatePath = p;
    break;
  }
}
if (!templatePath) {
  console.error('Template not found in', sheetsDir);
  process.exit(1);
}

const zip = new PizZip(fs.readFileSync(templatePath));
const docFile = zip.files['word/document.xml'];
if (!docFile) {
  console.error('No word/document.xml');
  process.exit(1);
}

let xml = docFile.asText();

// Dot-like characters: period, space, ellipsis, middle dot, bullet, em/en space, nbsp, full-width period
const dotOnlyPattern = '[.\\s\u2026\u00B7\u2022\u22EE\u22EF\u2003\u2002\u00A0\u3002\uFE52]+';

// Remove <w:r>...</w:r> runs whose only text content is dots/spaces (2+ chars)
// Permissive: allow any content between <w:r> and <w:t> (rPr, tab, etc.)
const dotRunRegex = new RegExp(
  '<w:r[^>]*>[\\s\\S]*?<w:t[^>]*>' + dotOnlyPattern + '</w:t>\\s*</w:r>',
  'g'
);

const before = xml.length;
xml = xml.replace(dotRunRegex, '');
const removed = before - xml.length;

// Remove dotted tab leaders so no dotted line is drawn (replace with none)
xml = xml.replace(/w:leader="dot"/g, 'w:leader="none"');

zip.file('word/document.xml', Buffer.from(xml, 'utf8'));
const outBuf = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
fs.writeFileSync(templatePath, outBuf);

const log = [
  'Removed dotted-line runs from: ' + templatePath,
  'Dot-run bytes removed: ' + removed,
  'Tab leaders: dot -> none'
].join('\n');
console.log(log);
fs.writeFileSync(path.join(__dirname, 'remove-dots-result.txt'), log);
