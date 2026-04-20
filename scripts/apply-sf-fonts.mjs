/**
 * One-shot: wrap numeric fontSize values with sf() from constants/uiTheme.js
 * Run: node scripts/apply-sf-fonts.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const walkDirs = ['app', 'components', 'utils'];
const extraFiles = ['Header.js', 'BottomNavigation.js'];

function collectJsFiles(relDir, acc = []) {
  const full = path.join(root, relDir);
  if (!fs.existsSync(full)) return acc;
  for (const name of fs.readdirSync(full)) {
    const p = path.join(full, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.expo') continue;
      collectJsFiles(path.join(relDir, name), acc);
    } else if (name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

let files = [];
for (const d of walkDirs) collectJsFiles(d, files);
for (const f of extraFiles) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) files.push(p);
}
files = [...new Set(files)];

function transform(content) {
  let c = content;

  c = c.replace(
    /fontSize:\s*Platform\.select\(\{\s*ios:\s*(\d+),\s*android:\s*(\d+),\s*default:\s*(\d+)\s*\}\)/g,
    'fontSize: Platform.select({ ios: sf($1), android: sf($2), default: sf($3) })'
  );

  c = c.replace(
    /fontSize:\s*Platform\.select\(\{\s*\n\s*ios:\s*(\d+),\s*\n\s*android:\s*(\d+),\s*\n\s*default:\s*(\d+),\s*\n\s*\}\)/g,
    'fontSize: Platform.select({\n      ios: sf($1),\n      android: sf($2),\n      default: sf($3),\n    })'
  );

  c = c.replace(/fontSize:\s*(\d+(?:\.\d+)?)(?=\s*[,}])/g, 'fontSize: sf($1)');
  c = c.replace(/fontSize:\s*sf\(sf\(/g, 'fontSize: sf(');

  return c;
}

function ensureSfImport(content, filePath) {
  if (!content.includes('sf(')) return content;
  if (/import\s*\{[^}]*\bsf\b[^}]*\}\s*from\s*['"][^'"]*uiTheme['"]/.test(content)) return content;

  const uiImport = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]*constants\/uiTheme)['"]/;
  const m = content.match(uiImport);
  if (m) {
    let inner = m[1].trim();
    if (/\bsf\b/.test(inner)) return content;
    inner = inner.replace(/,\s*$/, '');
    const next = inner ? `${inner}, sf` : 'sf';
    return content.replace(uiImport, `import { ${next} } from '${m[2]}'`);
  }

  const dir = path.dirname(filePath);
  let rel = path.relative(dir, path.join(root, 'constants', 'uiTheme.js'));
  rel = rel.split(path.sep).join('/');
  if (!rel.startsWith('.')) rel = './' + rel;
  const importLine = `import { sf } from '${rel}';\n`;
  return importLine + content;
}

let changed = 0;
for (const filePath of files) {
  if (filePath.includes(`${path.sep}constants${path.sep}uiTheme.js`)) continue;
  const raw = fs.readFileSync(filePath, 'utf8');
  const next = ensureSfImport(transform(raw), filePath);
  if (next !== raw) {
    fs.writeFileSync(filePath, next, 'utf8');
    changed++;
    console.log('updated:', path.relative(root, filePath));
  }
}
console.log('done, files changed:', changed);
