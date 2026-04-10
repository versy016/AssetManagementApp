const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const p = path.join(__dirname, '..', '..', 'assets', 'Sheets', 'Equipment hire lease disclaimer.docx');
const zip = new PizZip(fs.readFileSync(p));
const xml = zip.files['word/document.xml'].asText();
const out = [];
const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
let m;
while ((m = re.exec(xml)) !== null) {
  const t = m[1];
  if (t.length >= 2 && /^[\s.\u2026\u00B7\u2022\u2003\u2002\u00A0]+$/.test(t))
    out.push('DotOnly Len ' + t.length + ': ' + JSON.stringify(t.substring(0, 60))); else if (/[.\u2026]/.test(t) && t.length > 5)
    out.push('HasDot Len ' + t.length + ': ' + JSON.stringify(t.substring(0, 80)));
}
const msg = 'Leader dot count: ' + (xml.match(/leader="dot"/g) || []).length + '\nDot-only runs: ' + out.length + '\n' + out.join('\n');
fs.writeFileSync(path.join(__dirname, 'dot-check.txt'), msg);
console.log(msg);
