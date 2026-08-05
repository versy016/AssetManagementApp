# Deployment

GearOps runs on a single EC2 instance (Amazon Linux, user `ec2-user`) behind
nginx. The API runs under PM2; the Expo web build is served as static files.

```
/home/ec2-user/deploy/AssetManagementApp/     ← git checkout, tracks origin/main
├── inventory-api/                            ← the API (PM2 app: gearops-api)
│   ├── .env                                  ← secrets, NOT in git, never deployed
│   └── ecosystem.config.js                   ← PM2 process definition
└── web-build/dist/                           ← Expo web build, served by nginx
```

| Thing | Value |
|---|---|
| PM2 app name | `gearops-api` (cluster mode, `instances: 'max'`) |
| API port | 3000, proxied from `api.gearops.com.au` |
| nginx config | `/etc/nginx/conf.d/gearops.conf` |
| Web root | `/home/ec2-user/deploy/AssetManagementApp/web-build/dist` |
| Database | PostgreSQL, connection string in `inventory-api/.env` |

## Deploying

**Push to `main`.** That is the deployment. `.github/workflows/deploy-web.yml`
builds the Expo web bundle on a GitHub runner, copies it to the instance, then
over SSH: resets the checkout to `origin/main`, installs API dependencies,
regenerates the Prisma client, runs `prisma migrate deploy`, reloads PM2 and
nginx.

To ship an API-only change without the (slow) web build, run the workflow
manually from the Actions tab with **skip_web_build** ticked.

Required repository secrets: `EC2_HOST`, `EC2_SSH_KEY`,
`EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY`.

### If CI is unavailable

There is deliberately no second deploy script — a duplicate path drifts out of
sync with the workflow and fails quietly. Run the same steps by hand on the
instance instead:

```bash
cd /home/ec2-user/deploy/AssetManagementApp
git fetch origin main && git reset --hard FETCH_HEAD && git clean -fd
cd inventory-api
npm install --omit=dev --ignore-scripts
npx prisma generate
npx prisma migrate deploy
pm2 restart gearops-api --update-env && pm2 save
sudo nginx -s reload
```

That deploys the API only. The web bundle is built in CI; to rebuild it by hand,
run `npx expo export --platform web` from the repo root and copy `dist/` into
`web-build/dist/`.

## Environment

`inventory-api/.env` is gitignored and is **never** written by a deploy, so new
variables must be added on the instance by hand before the release that needs
them. After editing:

```bash
pm2 restart gearops-api --update-env
```

See `inventory-api/.env.example` for the full list. The ones a deploy commonly
needs added:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `SENTRY_DSN` | Error reporting. Unset ⇒ reporting is silently disabled |
| `SENTRY_ORG` | Org slug; lets the API map link a failing route to its issues |
| `METRICS_TOKEN` | **Required in production** for `GET /metrics/routes`; without it the endpoint refuses to serve |
| `DOCS_ENABLED` | `true` to serve the API map at `/docs`; off by default in production |
| `AWS_*`, `S3_*` | Document, image and QR storage |
| `SMTP_*` | Transactional email |
| `GOOGLE_PLACES_API_KEY` | Location autocomplete |

## Database migrations

Applied automatically by the deploy (`npx prisma migrate deploy`). To run or
inspect by hand on the instance:

```bash
cd /home/ec2-user/deploy/AssetManagementApp/inventory-api
npx prisma migrate status
npx prisma migrate deploy
```

Migrations are forward-only — Prisma has no `down`. Roll back the code, and
leave additive schema changes in place.

## Verifying a release

```bash
pm2 list                                    # gearops-api online, restart count sane
pm2 logs gearops-api --lines 40 --nostream  # look for [sentry] Initialised
curl -s https://api.gearops.com.au/         # {"status":"ok", ...}
```

With `METRICS_TOKEN` set, per-route traffic and error counts:

```bash
curl -s "http://localhost:3000/metrics/routes?minutes=15" -H "X-Metrics-Token: $METRICS_TOKEN"
```

## The API map

`/docs` renders every route, its guard, and — when metrics are enabled — live
request and error counts. It is an inventory of the whole API surface, so it is
disabled in production unless `DOCS_ENABLED=true`, and `/docs` and `/metrics`
should be denied at nginx.

Reach it through a tunnel, which bypasses nginx entirely:

```bash
ssh -L 3000:localhost:3000 ec2-user@<host>   # then open http://localhost:3000/docs
```

## Rollback

```bash
cd /home/ec2-user/deploy/AssetManagementApp
git reset --hard <known-good-sha>
cd inventory-api && npm install --omit=dev --ignore-scripts && npx prisma generate
pm2 restart gearops-api --update-env
```

Reverting the commit on `main` and letting CI redeploy is preferable when there
is time — it keeps the instance and `origin/main` in agreement.

## Monitoring

- `pm2 logs gearops-api` — application logs
- `pm2 monit` — live CPU and memory
- Sentry — errors, grouped, with the acting user attached
- `/docs` — per-route traffic and error rates

## Backups

Database backups are not configured by this repo. Set up a `pg_dump` cron job.
