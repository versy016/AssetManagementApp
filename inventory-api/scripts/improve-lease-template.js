/**
 * Improves the Equipment hire lease disclaimer .docx template layout and readability.
 * Run from inventory-api: node scripts/improve-lease-template.js
 * Modifies the file in place; keep a backup if needed.
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

// Backup original before modifying
const templateName = path.basename(templatePath);
const backupPath = path.join(sheetsDir, templateName.replace('.docx', '_backup.docx'));
fs.copyFileSync(templatePath, backupPath);
console.log('Backup saved:', backupPath);

const zip = new PizZip(fs.readFileSync(templatePath));
const docFile = zip.files['word/document.xml'];
if (!docFile) {
  console.error('No word/document.xml');
  process.exit(1);
}

let xml = docFile.asText();

// 1) Center the title and add space below: first paragraph in body (Equipment Lease)
const bodyStart = xml.indexOf('<w:body>');
const firstP = xml.indexOf('<w:p ', bodyStart);
const firstPPr = xml.indexOf('<w:pPr>', firstP);
const firstPEnd = xml.indexOf('</w:p>', firstP);
if (firstP !== -1 && firstPPr !== -1 && firstPPr < firstPEnd) {
  const insertAt = firstPPr + 7;
  xml = xml.slice(0, insertAt) +
    '<w:jc w:val="center"/><w:spacing w:before="120" w:after="280"/>' +
    xml.slice(insertAt);
}

// 2) Add spacing before paragraphs that are section labels (contain a label then [placeholder] or colon)
//    Target: paragraph whose first text is "Address of company" or "Contact Pickup" or "Contact Number"
//    Insert spacing at start of that paragraph's pPr
const sectionLabels = [
  'Address of company/ entity/ person:',
  'Contact Pickup (Name):',
  'Contact Number',
  'Terms of lease will commence',
  'Date item to be returned',
  'Item to be leased at a cost',
  'List equipment including',
  'Serial number(s)',
  'This contract is accepted',
  'Signed by lessee',
  'Signed by lessor',
];
for (const label of sectionLabels) {
  const idx = xml.indexOf(label);
  if (idx === -1) continue;
  const pStart = xml.lastIndexOf('<w:p ', idx);
  if (pStart === -1) continue;
  const pPrStart = xml.indexOf('<w:pPr>', pStart);
  if (pPrStart === -1 || pPrStart > idx) continue;
  const insertAt = pPrStart + 7;
  if (xml.slice(insertAt, insertAt + 30).includes('spacing')) continue;
  xml = xml.slice(0, insertAt) + '<w:spacing w:before="140" w:after="50"/>' + xml.slice(insertAt);
}

// 3) Make field labels bold where we have a run with only the label (no [placeholder])
const makeLabelBold = (label) => {
  const escaped = label.replace(/[()/\\]/g, '\\$&');
  const re = new RegExp(
    `(<w:r[^>]*>)\\s*<w:rPr>\\s*<w:rFonts w:ascii="Calibri"[^/]*/>\\s*<w:color[^/]*/>\\s*<w:sz w:val="22"[^/]*/>\\s*<w:szCs w:val="22"[^/]*/>\\s*<w:lang[^/]*/>\\s*</w:rPr>\\s*<w:t>${escaped}</w:t>`,
    's'
  );
  const withBold = '$1<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Arial"/><w:b/><w:color w:val="333333"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr><w:t>' + label + '</w:t>';
  if (xml.match(re)) xml = xml.replace(re, withBold);
};
makeLabelBold('Address of company/ entity/ person:');
makeLabelBold('Contact Pickup (Name):');
makeLabelBold('Contact Number');
makeLabelBold('Date:');
makeLabelBold('Time:');
makeLabelBold('Date item to be returned');
makeLabelBold('Item to be leased at a cost of $.');
makeLabelBold('Serial number(s)');

zip.file('word/document.xml', Buffer.from(xml, 'utf8'));
const outBuf = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
fs.writeFileSync(templatePath, outBuf);
console.log('Updated template:', templatePath);
console.log('Changes: centered title with spacing, added spacing before sections, bold field labels.');
