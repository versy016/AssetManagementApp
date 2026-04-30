/**
 * User-facing copy for upload controls (keep aligned with inventory-api multer rules).
 */

/** Asset / type hero images & task action photos (see routes/assets.js uploadActionImages). */
export const IMAGE_TYPES_SHORT = 'PNG, JPG, JPEG, WEBP, GIF, BMP, TIFF, HEIC, HEIF, AVIF';

export const IMAGE_UPLOAD_HINT = `Allowed: ${IMAGE_TYPES_SHORT}. Max 5 MB per image.`;

/** Asset main document field on create/edit (pdf, doc, docx). */
export const ASSET_DOCUMENT_FIELD_HINT = 'Allowed: PDF, Word (.doc, .docx). Max 10 MB.';

/** Certificates / nested asset documents (assetDocuments.js). */
export const CERT_DOCUMENT_UPLOAD_HINT =
  'Allowed: PDF, Word (.doc, .docx), Excel (.xlsx, .xls), PowerPoint (.pptx), PNG, JPG, JPEG, WEBP. Max 20 MB.';

/** Task modal “report” attachment when images allowed. */
export const TASK_REPORT_UPLOAD_HINT = 'Allowed: PDF or images (PNG, JPG, WEBP, etc.).';
