/**
 * Patches assets/Sheets/Equipment hire lease disclaimer.docx:
 * 1) Lease summary → 4 columns (label | value | label | value), with Contact Person + Company/Entity or Project on row 1.
 * 2) Move "Insurance and Responsibility" + "Acceptance and Signatures" after
 *    "Disclaimer of Liability and Additional Terms".
 *
 * Run: node scripts/patch-hire-lease-docx.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SHEETS = path.join(ROOT, 'assets', 'Sheets');
const DOCX = path.join(SHEETS, 'Equipment hire lease disclaimer.docx');
const WORK = path.join(SHEETS, '_lease_patch_work');
const DOC_XML = path.join(WORK, 'word', 'document.xml');

const TBL_PR = `<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="8" w:space="0" w:color="D7DEE8"/><w:left w:val="single" w:sz="8" w:space="0" w:color="D7DEE8"/><w:bottom w:val="single" w:sz="8" w:space="0" w:color="D7DEE8"/><w:right w:val="single" w:sz="8" w:space="0" w:color="D7DEE8"/><w:insideH w:val="single" w:sz="8" w:space="0" w:color="D7DEE8"/><w:insideV w:val="single" w:sz="8" w:space="0" w:color="D7DEE8"/></w:tblBorders><w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>`;
/** Col widths: label | value | label | value (twips), total 9977 */
const GRID4 = `<w:tblGrid><w:gridCol w:w="1644"/><w:gridCol w:w="3288"/><w:gridCol w:w="1757"/><w:gridCol w:w="3288"/></w:tblGrid>`;

function labelCell(width, text) {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="EEF3F8"/><w:tcMar><w:top w:w="90" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/></w:tcPr><w:p w14:paraId="5E837862" w14:textId="3514EEA8" w:rsidR="00C47F1F" w:rsidRDefault="00F7078D"><w:pPr><w:spacing w:after="0" w:line="269" w:lineRule="auto"/><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="183A5A"/><w:sz w:val="18"/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:tc>`;
}

function valueCell(width, runs, gridSpan = 0) {
  const span = gridSpan > 1 ? `<w:gridSpan w:val="${gridSpan}"/>` : '';
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span}<w:tcMar><w:top w:w="90" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/></w:tcPr><w:p w14:paraId="74AE2376" w14:textId="2753EEE9" w:rsidR="00C47F1F" w:rsidRPr="00F7078D" w:rsidRDefault="005B61F8"><w:pPr><w:spacing w:after="0" w:line="269" w:lineRule="auto"/><w:jc w:val="left"/><w:rPr><w:b/><w:bCs/></w:rPr></w:pPr>${runs}</w:p></w:tc>`;
}

function row4(c1, c2, c3, c4) {
  return `<w:tr w:rsidR="00C47F1F" w14:paraId="5CE68027" w14:textId="77777777">${c1}${c2}${c3}${c4}</w:tr>`;
}

/** One label cell + value spanning columns 2–4 */
function rowLabelPlusSpan(labelText, runs) {
  return `<w:tr w:rsidR="00C47F1F" w14:paraId="5CE68027" w14:textId="77777777">${labelCell(W1, labelText)}${valueCell(W234, runs, 3)}</w:tr>`;
}

const br = (t) =>
  `<w:r w:rsidRPr="00F7078D"><w:rPr><w:b/><w:bCs/><w:sz w:val="20"/></w:rPr><w:t>${t}</w:t></w:r>`;
const NAME_RUNS = `${br('[')}<w:r w:rsidR="000F435E"><w:rPr><w:b/><w:bCs/><w:sz w:val="20"/></w:rPr><w:t>name</w:t></w:r>${br(']')}`;
const DAYS_RUNS = `${br('[days]')}<w:r w:rsidR="00F7078D" w:rsidRPr="00F7078D"><w:rPr><w:b/><w:bCs/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve"> days</w:t></w:r>`;
/** Docxtemplater tags: company or project (often one is blank) */
const COMPANY_PROJECT_RUNS = `${br('[companyEntity]')}<w:r w:rsidR="00F7078D"><w:rPr><w:b/><w:bCs/><w:sz w:val="20"/></w:rPr><w:br/></w:r>${br('[project]')}`;

const W1 = '1644';
const W2 = '3288';
const W3 = '1757';
const W4 = '3288';
const W234 = '8333'; /* 3288+1757+3288 */

const NEW_LEASE_TABLE = `<w:tbl>${TBL_PR}${GRID4}
${row4(
  labelCell(W1, 'Contact Person'),
  valueCell(W2, NAME_RUNS),
  labelCell(W3, 'Company / Entity or Project'),
  valueCell(W4, COMPANY_PROJECT_RUNS)
)}
${rowLabelPlusSpan('Contact Number', br('[number]'))}
${rowLabelPlusSpan('Address', br('[address]'))}
${row4(
  labelCell(W1, 'Start Date'),
  valueCell(W2, br('[startdate]')),
  labelCell(W3, 'Start Time'),
  valueCell(W4, br('[starttime]'))
)}
${row4(
  labelCell(W1, 'Lease Duration'),
  valueCell(W2, DAYS_RUNS),
  labelCell(W3, 'Return Date'),
  valueCell(W4, br('[enddate]'))
)}
${row4(
  labelCell(W1, 'Daily Hire Rate'),
  valueCell(W2, br('$[cost] per day')),
  labelCell(W3, 'Agreement Date'),
  valueCell(W4, br('[todaysdate]'))
)}
</w:tbl>`;

function extractWorkdir() {
  if (fs.existsSync(WORK)) fs.rmSync(WORK, { recursive: true });
  fs.mkdirSync(WORK, { recursive: true });
  const zipPath = path.join(SHEETS, '_lease_patch_in.zip');
  fs.copyFileSync(DOCX, zipPath);
  const psZip = zipPath.replace(/'/g, "''");
  const psWork = WORK.replace(/'/g, "''");
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${psZip}' -DestinationPath '${psWork}' -Force"`,
    { stdio: 'inherit' }
  );
  fs.unlinkSync(zipPath);
}

function zipDocx() {
  const outZip = path.join(SHEETS, '_lease_patch_out.zip');
  if (fs.existsSync(outZip)) fs.unlinkSync(outZip);
  const psWork = WORK.replace(/'/g, "''");
  const psOut = outZip.replace(/'/g, "''");
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path (Join-Path '${psWork}' '*') -DestinationPath '${psOut}' -Force"`,
    { stdio: 'inherit' }
  );
  fs.copyFileSync(outZip, DOCX);
  fs.unlinkSync(outZip);
  fs.rmSync(WORK, { recursive: true });
}

function main() {
  extractWorkdir();
  const xml = fs.readFileSync(DOC_XML, 'utf8');

  const lsIdx = xml.indexOf('<w:t>Lease Summary</w:t>');
  if (lsIdx < 0) throw new Error('Lease Summary not found');
  const leaseTblStart = xml.indexOf('<w:tbl>', lsIdx);
  const leaseTblEnd = xml.indexOf('</w:tbl>', leaseTblStart) + '</w:tbl>'.length;

  const equipTitle = xml.indexOf('<w:t>Equipment Details</w:t>');
  if (equipTitle < 0) throw new Error('Equipment Details not found');
  const equipParaStart = xml.lastIndexOf('<w:p ', equipTitle);
  const equipTblStart = xml.indexOf('<w:tbl>', equipTitle);
  const equipTblEnd = xml.indexOf('</w:tbl>', equipTblStart) + '</w:tbl>'.length;

  const insTitle = xml.indexOf('<w:t>Insurance and Responsibility</w:t>');
  if (insTitle < 0) throw new Error('Insurance not found');
  const insParaStart = xml.lastIndexOf('<w:p ', insTitle);
  const insTblStart = xml.indexOf('<w:tbl>', insTitle);
  const insTblEnd = xml.indexOf('</w:tbl>', insTblStart) + '</w:tbl>'.length;

  const accTitle = xml.indexOf('<w:t>Acceptance and Signatures</w:t>');
  if (accTitle < 0) throw new Error('Acceptance not found');
  const accParaStart = xml.lastIndexOf('<w:p ', accTitle);
  const signTblStart = xml.indexOf('<w:tbl>', xml.indexOf('This contract is accepted', accTitle));
  const signTblEnd = xml.indexOf('</w:tbl>', signTblStart) + '</w:tbl>'.length;

  const discTitle = xml.indexOf('<w:t>Disclaimer of Liability and Additional Terms</w:t>');
  if (discTitle < 0) throw new Error('Disclaimer title not found');
  const discParaStart = xml.lastIndexOf('<w:p ', discTitle);
  const sectPrIdx = xml.indexOf('<w:sectPr', signTblEnd);
  if (sectPrIdx < 0) throw new Error('sectPr not found');

  const beforeLease = xml.slice(0, leaseTblStart);
  const equipmentSection = xml.slice(equipParaStart, equipTblEnd);
  const insuranceSection = xml.slice(insParaStart, accParaStart);
  const acceptanceSection = xml.slice(accParaStart, signTblEnd);
  const disclaimerSection = xml.slice(discParaStart, sectPrIdx);
  const tail = xml.slice(sectPrIdx);

  const newXml =
    beforeLease +
    NEW_LEASE_TABLE +
    equipmentSection +
    disclaimerSection +
    insuranceSection +
    acceptanceSection +
    tail;

  fs.writeFileSync(DOC_XML, newXml, 'utf8');
  zipDocx();
  console.log('OK:', DOCX);
}

main();
