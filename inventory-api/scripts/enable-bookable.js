// scripts/enable-bookable.js
// One-time: mark every existing asset type as bookable (the new default). Admins can
// then turn specific types off in the type editor. Run once after adopting the
// "bookable by default" behaviour:  node scripts/enable-bookable.js
const prisma = require('../lib/prisma');

(async () => {
  try {
    const r = await prisma.asset_types.updateMany({ data: { bookable: true } });
    console.log(`Set bookable=true on ${r.count} asset type(s).`);
  } catch (e) {
    console.error('Failed:', e.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
