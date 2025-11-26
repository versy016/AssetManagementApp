-- Create asset_documents table to support multiple attachments per asset
CREATE TABLE IF NOT EXISTS "asset_documents" (
  "id"                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  "asset_id"            text NOT NULL,
  "title"               text,
  "kind"                text,
  "related_date_label"  text,
  "related_date"        date,
  "s3_key"              text NOT NULL,
  "url"                 text NOT NULL,
  "content_type"        text,
  "size_bytes"          integer,
  "uploaded_by"         text,
  "created_at"          timestamp(6) NOT NULL DEFAULT now(),
  "deleted_at"          timestamp(6),
  "metadata"            jsonb,
  "asset_type_field_id" text
);

-- Indexes
CREATE INDEX IF NOT EXISTS "asset_documents_asset_id_created_at_idx" ON "asset_documents" ("asset_id", "created_at");
CREATE INDEX IF NOT EXISTS "asset_documents_field_id_idx" ON "asset_documents" ("asset_type_field_id");

-- FKs
ALTER TABLE "asset_documents"
  ADD CONSTRAINT "asset_documents_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE;

ALTER TABLE "asset_documents"
  ADD CONSTRAINT "asset_documents_field_id_fkey"
    FOREIGN KEY ("asset_type_field_id") REFERENCES "asset_type_fields"("id") ON DELETE NO ACTION;
