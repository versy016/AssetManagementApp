/**
 * Merges split [placeholder] runs in the Equipment hire lease .docx template
 * so docxtemplater can replace them (tags must be in a single run).
 * Run from inventory-api: node scripts/fix-lease-template.js
 */
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const templateName = 'Equipment hire lease disclaimer .docx';
const base = path.join(__dirname, '..', '..', 'assets', 'Sheets');
const templatePath = path.join(base, templateName);

if (!fs.existsSync(templatePath)) {
  console.error('Template not found:', templatePath);
  process.exit(1);
}

const buf = fs.readFileSync(templatePath);
const zip = new PizZip(buf);
const docFile = zip.files['word/document.xml'];
if (!docFile) {
  console.error('No word/document.xml in template');
  process.exit(1);
}

let xml = docFile.asText();

// Merge split [tagname] runs: " [</w:t></w:r>...<w:t>tagname</w:t></w:r>...<w:t>]</w:t></w:r>"
// into a single run so docxtemplater can replace them (tags must be in one run).
// First <w:r> can contain <w:rPr> before <w:t>.
const splitTagRegex = /<w:r([^>]*)>[\s\S]*?<w:t([^>]*)>\s*\[\s*<\/w:t>\s*<\/w:r>\s*(?:<w:proofErr[^/]*\/>\s*)?<w:r[^>]*>[\s\S]*?<w:t>(\w+)<\/w:t>\s*<\/w:r>\s*(?:<w:proofErr[^/]*\/>\s*)?<w:r[^>]*>[\s\S]*?<w:t>\]\s*<\/w:t>\s*<\/w:r>/g;
const merged = xml.replace(splitTagRegex, (match, rAttrs, tAttrs, tagName) => {
  return `<w:r${rAttrs}><w:t${tAttrs} xml:space="preserve"> [${tagName}]</w:t></w:r>`;
});

let final = merged;
let prev = '';
while (prev !== final) {
  prev = final;
  final = final.replace(splitTagRegex, (match, rAttrs, tAttrs, tagName) => {
    return `<w:r${rAttrs}><w:t${tAttrs} xml:space="preserve"> [${tagName}]</w:t></w:r>`;
  });
}

zip.file('word/document.xml', Buffer.from(final, 'utf8'));

const outBuf = zip.generate({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 6 },
});

fs.writeFileSync(templatePath, outBuf);
console.log('Updated template:', templatePath);
