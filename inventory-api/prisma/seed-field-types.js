const { PrismaClient } = require('../generated/prisma');
const prisma = new PrismaClient();

async function main() {
  const fieldTypes = [
    {
      name: 'Text',
      slug: 'text',
      description: 'Single line text input',
      has_options: false,
      validation_rules: { maxLength: 255 }
    },
    {
      name: 'Text Area',
      slug: 'textarea',
      description: 'Multi-line text input',
      has_options: false,
      validation_rules: { maxLength: 5000 }
    },
    {
      name: 'Number',
      slug: 'number',
      description: 'Numeric input',
      has_options: false,
      validation_rules: { min: 0, max: 999999 }
    },
    {
      name: 'Select',
      slug: 'select',
      description: 'Single select from options',
      has_options: true,
      validation_rules: {}
    },
    {
      name: 'Checkbox',
      slug: 'checkbox',
      description: 'Boolean true/false',
      has_options: false,
      validation_rules: {}
    },
    {
      name: 'Date',
      slug: 'date',
      description: 'Date picker',
      has_options: false,
      validation_rules: {}
    }
  ];

  for (const fieldType of fieldTypes) {
    await prisma.field_types.upsert({
      where: { slug: fieldType.slug },
      update: {},
      create: fieldType,
    });
  }

  console.log('Field types seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
