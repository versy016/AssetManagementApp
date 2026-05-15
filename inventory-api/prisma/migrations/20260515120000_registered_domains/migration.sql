-- Registered organisation domains → display name (hire signing audit PDF, etc.)

CREATE TABLE "registered_domains" (
    "id" TEXT NOT NULL DEFAULT uuid_generate_v4(),
    "domain" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registered_domains_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "registered_domains_domain_key" ON "registered_domains"("domain");

INSERT INTO "registered_domains" ("id", "domain", "display_name", "created_at", "updated_at")
VALUES (uuid_generate_v4(), 'engsurveys.com.au', 'Engineering Surveys', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
