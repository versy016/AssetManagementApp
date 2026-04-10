const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const base = path.join(__dirname, '..', '..', 'assets', 'Sheets');
const name = 'Equipment hire lease disclaimer.docx';
const p = path.join(base, name);
const out = path.join(__dirname, 'docx-excerpt.txt');
if (!fs.existsSync(p)) {
  fs.writeFileSync(out, 'File not found: ' + p);
  process.exit(1);
}
const buf = fs.readFileSync(p);
const zip = new PizZip(buf);
const doc = zip.files['word/document.xml'];
if (!doc) {
  fs.writeFileSync(out, 'No document.xml. Files: ' + Object.keys(zip.files).join(', '));
  process.exit(1);
}
const text = doc.asText();
const excerpt = text.replace(/>\s*</g, '>\n<').slice(0, 20000);
fs.writeFileSync(out, excerpt);
console.log('Wrote', out, 'length', excerpt.length);
