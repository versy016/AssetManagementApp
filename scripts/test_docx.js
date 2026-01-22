const { Document, Packer, Paragraph, HeadingLevel, AlignmentType } = require('docx');
const fs = require('fs');
const path = require('path');

async function test() {
  try {
    console.log('Testing docx library...');
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({
            text: "Test Document",
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({
            text: "This is a test paragraph.",
          }),
        ],
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    const outputPath = path.join(__dirname, '..', 'test_output.docx');
    fs.writeFileSync(outputPath, buffer);
    console.log('SUCCESS! File created at:', outputPath);
  } catch (error) {
    console.error('ERROR:', error.message);
    console.error(error.stack);
  }
}

test();

