// inventory-api/scripts/seedFieldTypes.js
require('dotenv').config({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });
const { PrismaClient } = require('../generated/prisma');
const prisma = new PrismaClient();

const TYPES = [
  { name: 'Text',        slug: 'text',        has_options: false, description: 'Single-line string' },
  { name: 'Textarea',    slug: 'textarea',    has_options: false, description: 'Multi-line text' },
  { name: 'Number',      slug: 'number',      has_options: false, description: 'Integer/float' },
  { name: 'Boolean',     slug: 'boolean',     has_options: false, description: 'True/False' },
  { name: 'Date',        slug: 'date',        has_options: false },
  { name: 'Datetime',    slug: 'datetime',    has_options: false },
  { name: 'Email',       slug: 'email',       has_options: false },
  { name: 'URL',         slug: 'url',         has_options: false },
  { name: 'Currency',    slug: 'currency',    has_options: false },
  { name: 'Select',      slug: 'select',      has_options: true,  description: 'One option from list' },
  { name: 'Multi-Select',slug: 'multiselect', has_options: true,  description: 'Many options from list' },
];

async function main() {
  for (const t of TYPES) {
    await prisma.field_types.upsert({
      where: { slug: t.slug },
      update: {
        name: t.name,
        description: t.description ?? null,
        has_options: t.has_options,
        updated_at: new Date(),
      },
      create: {
        name: t.name,
        slug: t.slug,
        description: t.description ?? null,
        has_options: t.has_options,
        validation_rules: null,
      },
    });
  }
  console.log(`Seeded/updated ${TYPES.length} field types`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => (console.error(e), prisma.$disconnect(), process.exit(1)));
