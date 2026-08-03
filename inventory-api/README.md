# Inventory Management API

This is the backend API for the Asset Management Application.

## Prerequisites

- Node.js 18 or higher
- Docker and Docker Compose
- npm or yarn

## Setup

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Update the `.env` file with your local configuration.

3. Start the PostgreSQL database:
   ```bash
   docker-compose up -d
   ```

4. Install dependencies:
   ```bash
   npm install
   ```

5. Run database migrations:
   ```bash
   npx prisma migrate dev
   ```

## Development

- Start the development server:
  ```bash
  npm run dev
  ```

- Run tests:
  ```bash
  npm test
  ```

- Access Prisma Studio (database GUI):
  ```bash
  npx prisma studio
  ```

## Environment Variables

- `PORT` - Port to run the server on (default: 3000)
- `NODE_ENV` - Environment (development, production, test)
- `DATABASE_URL` - PostgreSQL connection string
- `QR_CODE_PATH` - Path to store QR code images
- `DOCS_ENABLED` - Serve the API map at `/docs` in production (default: off in production)
- `METRICS_ENABLED` / `METRICS_TOKEN` - Request metrics collection and read access (see below)

## API Documentation

Once the server is running, you can access:

- API: http://localhost:3000
- API map: http://localhost:3000/docs
- pgAdmin: http://localhost:5050
  - Email: admin@example.com
  - Password: admin

### API map

`/docs` serves an interactive map of every mounted route — which router owns it,
which guard it carries, what it calls out to, and (when metrics are enabled) how
much traffic and how many 5xx it is serving right now.

Both the map data and an OpenAPI 3.1 document are generated from the route tree,
never written by hand:

```bash
npm run api:map     # writes public/api-map.data.json + public/openapi.json
```

It regenerates automatically on commit when `routes/*.js` or `server.js` change
(wired via lint-staged), so the map cannot drift from the code. `public/openapi.json`
imports directly into Scalar, Bruno or Postman.

The map is served in development and disabled in production unless `DOCS_ENABLED=true`
— it is a complete inventory of endpoints and their guards, which is worth keeping
private.

### Request metrics

`lib/metrics.js` records method, route template, status and duration per request,
buffers them in memory and flushes per-minute rollups to `api_route_metrics`. The
upsert is what makes this correct under PM2 cluster mode: every worker accumulates
into the same row rather than reporting only its own slice.

Read them at `GET /metrics/routes?minutes=60`.

- `METRICS_ENABLED` — set to `false` to turn collection off entirely (default on)
- `METRICS_TOKEN` — shared token required to read the endpoint; pass as
  `X-Metrics-Token` or `?key=`. Without it the endpoint serves only outside
  production, so a deploy cannot expose it by omission.
- `METRICS_FLUSH_MS` — flush interval, default 15000
- `METRICS_RETENTION_DAYS` — rows older than this are pruned on flush, default 7

## Database

- Host: localhost
- Port: 5432
- Database: asset_management
- Username: postgres
- Password: postgres

## Testing

Run the test suite:

```bash
npm test
```

## Linting and Formatting

- Lint: `npm run lint`
- Format: `npm run format`
