// inventory-api/utils/slugify.js
module.exports = function slugify(input) {
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')     // remove non-word chars
    .replace(/\s+/g, '-')         // spaces -> dashes
    .replace(/-+/g, '-');         // collapse dashes
};
