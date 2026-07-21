// scripts/generate-erd.js
// Zero-dependency generator: parses prisma/schema.prisma and writes prisma/ERD.md
// (a Mermaid erDiagram that renders on GitHub / VS Code). Run with `npm run db:erd`.
//
// Deliberately NOT a Prisma generator block: keeping it out of `prisma generate`
// means it never runs on production `postinstall`, so deploys can't break on a
// missing dev tool. It never throws — a parse hiccup logs a warning and exits 0 so
// it can't block a commit hook.

const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.resolve(__dirname, '..', 'prisma', 'schema.prisma');
const OUT_PATH = path.resolve(__dirname, '..', 'prisma', 'ERD.md');

const SCALAR_TYPES = {
  String: 'string',
  Boolean: 'boolean',
  DateTime: 'datetime',
  Int: 'int',
  BigInt: 'bigint',
  Float: 'float',
  Decimal: 'decimal',
  Json: 'json',
  Bytes: 'bytes',
};

function main() {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

  const enumNames = new Set([...schema.matchAll(/^\s*enum\s+(\w+)\s*\{/gm)].map((m) => m[1]));

  // Grab each `model X { ... }` block (bodies contain no nested braces).
  const modelBlocks = [...schema.matchAll(/^\s*model\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm)];
  const modelNames = new Set(modelBlocks.map((m) => m[1]));

  const entities = []; // { name, attrs: [{ type, name, key, comment }] }
  const relations = []; // { from, to, kind: 'many' | 'one', label }

  for (const [, modelName, body] of modelBlocks) {
    const lines = body.split('\n');
    const uniqueCols = new Set();
    const fkCols = new Set();
    const scalarFields = [];
    const relationFields = [];

    // First pass: classify each field line.
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('//') || line.startsWith('///') || line.startsWith('@@')) continue;

      const m = line.match(/^(\w+)\s+([A-Za-z0-9_]+)(\[\])?(\?)?(.*)$/);
      if (!m) continue;
      const [, fieldName, baseType, isList, isOpt, rest] = m;

      if (modelNames.has(baseType)) {
        // Relation field (object side). Only the side with `fields:` owns the FK.
        const fieldsMatch = rest.match(/fields:\s*\[([^\]]+)\]/);
        if (fieldsMatch) {
          const fkList = fieldsMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
          fkList.forEach((c) => fkCols.add(c));
          const nameMatch = rest.match(/@relation\(\s*"([^"]+)"/) || rest.match(/name:\s*"([^"]+)"/);
          relationFields.push({
            target: baseType,
            fk: fkList[0],
            label: nameMatch ? nameMatch[1] : fieldName,
          });
        }
        continue;
      }

      // Scalar / enum field → becomes a column in the diagram.
      if (/@unique/.test(rest)) uniqueCols.add(fieldName);
      let type;
      if (SCALAR_TYPES[baseType]) type = SCALAR_TYPES[baseType];
      else if (enumNames.has(baseType)) type = 'enum';
      else type = baseType.toLowerCase();
      scalarFields.push({ fieldName, type, isId: /@id/.test(rest), isUnique: /@unique/.test(rest) });
    }

    // Second pass: build attribute rows now that FK columns are known.
    const attrs = scalarFields.map((f) => {
      let key = '';
      const comment = [];
      if (f.isId) key = 'PK';
      else if (fkCols.has(f.fieldName)) {
        key = 'FK';
        if (f.isUnique) comment.push('unique 1:1');
      } else if (f.isUnique) key = 'UK';
      return { type: f.type, name: f.fieldName, key, comment: comment.join(' ') };
    });
    entities.push({ name: modelName, attrs });

    // Emit one edge per owned relation.
    for (const r of relationFields) {
      const oneToOne = uniqueCols.has(r.fk);
      relations.push({ from: r.target, to: modelName, kind: oneToOne ? 'one' : 'many', label: r.label });
    }
  }

  const connected = new Set();
  relations.forEach((r) => {
    connected.add(r.from);
    connected.add(r.to);
  });
  const standalone = [...modelNames].filter((n) => !connected.has(n)).sort();

  fs.writeFileSync(OUT_PATH, render(entities, relations, standalone));
  console.log(`ERD written: ${path.relative(process.cwd(), OUT_PATH)} (${entities.length} tables, ${relations.length} relations)`);
}

function render(entities, relations, standalone) {
  const relLines = relations
    .map((r) => `    ${r.from} ${r.kind === 'one' ? '||--||' : '||--o{'} ${r.to} : "${r.label}"`)
    .join('\n');

  const entityLines = entities
    .map((e) => {
      const rows = e.attrs
        .map((a) => `        ${a.type} ${a.name}${a.key ? ` ${a.key}` : ''}${a.comment ? ` "${a.comment}"` : ''}`)
        .join('\n');
      return `    ${e.name} {\n${rows}\n    }`;
    })
    .join('\n\n');

  const standaloneNote = standalone.length
    ? `\n> **Standalone tables** (no foreign-key relations): ${standalone.map((s) => `\`${s}\``).join(', ')}.\n`
    : '';

  return `# GearOps — Database ER Diagram

<!-- AUTO-GENERATED from schema.prisma by scripts/generate-erd.js. Do not edit by hand — run \`npm run db:erd\`. -->

Diagram of the PostgreSQL schema, generated from \`schema.prisma\`. GitHub, VS Code
(Markdown Preview Mermaid Support), and most Markdown viewers render it natively.

> Legend: \`PK\` = primary key, \`FK\` = foreign key, \`UK\` = unique.
> \`||--o{\` = one-to-many, \`||--||\` = one-to-one.
${standaloneNote}
\`\`\`mermaid
erDiagram
${relLines}

${entityLines}
\`\`\`

## Regenerating

\`\`\`bash
npm run db:erd        # from inventory-api/
\`\`\`

It also regenerates automatically on commit when \`prisma/schema.prisma\` changes
(wired via lint-staged in \`package.json\`).
`;
}

try {
  main();
} catch (e) {
  // Never block a commit hook over the diagram.
  console.warn('generate-erd: skipped (', e && e.message ? e.message : e, ')');
  process.exit(0);
}
