-- Per-minute request counters per route template (see lib/metrics.js).
-- Pre-aggregated on write, so this table grows with the number of distinct routes
-- touched per minute, not with request volume.

CREATE TABLE "api_route_metrics" (
    "id"            TEXT         NOT NULL DEFAULT uuid_generate_v4(),
    "bucket"        TIMESTAMPTZ(6) NOT NULL,
    "router"        TEXT         NOT NULL,
    "method"        TEXT         NOT NULL,
    "route"         TEXT         NOT NULL,
    "requests"      INTEGER      NOT NULL DEFAULT 0,
    "client_errors" INTEGER      NOT NULL DEFAULT 0,
    "server_errors" INTEGER      NOT NULL DEFAULT 0,
    "total_ms"      INTEGER      NOT NULL DEFAULT 0,
    "max_ms"        INTEGER      NOT NULL DEFAULT 0,

    CONSTRAINT "api_route_metrics_pkey" PRIMARY KEY ("id")
);

-- The upsert target. Every PM2 worker inserts against this key, so concurrent
-- flushes accumulate into one row instead of the last writer winning.
CREATE UNIQUE INDEX "api_route_metrics_bucket_method_route_key"
    ON "api_route_metrics" ("bucket", "method", "route");

-- Window queries filter on bucket; the map groups by router.
CREATE INDEX "api_route_metrics_bucket_idx"  ON "api_route_metrics" ("bucket");
CREATE INDEX "api_route_metrics_router_idx"  ON "api_route_metrics" ("router");
