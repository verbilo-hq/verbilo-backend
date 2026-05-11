# Verbilo Backend

Verbilo is a multi-tenant intranet SaaS for UK dental group practices. This repository contains the NestJS API, using Prisma against a Neon PostgreSQL database and validating AWS Cognito JWTs, deployed to Render.

## Tech stack (canonical)

| Layer | Service |
|---|---|
| Source / CI | GitHub (`verbilo-hq`) |
| Frontend | Vercel |
| Backend | Render |
| Database | Neon PostgreSQL |
| Auth | AWS Cognito (eu-north-1) |
| DNS | AWS Route 53 (planned). Records currently live at the IONOS registrar; Route 53 migration is pending. |
| Alerting / errors | Sentry (wired in backend; no-op when `SENTRY_DSN` is unset). |

Render health checks should use `GET /health` (returns 200 only when the DB is reachable).

## Local setup

```bash
npm install
cp .env.example .env
npm run start:dev
```

- Baseline security headers are set via `helmet` in `src/main.ts` (HSTS 1y + `preload`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and no CSP — CSP is frontend-side via `vercel.json` in VER-21).

## Environment variables

- `DATABASE_URL` — PostgreSQL connection string for the Neon database.
- `COGNITO_USER_POOL_ID` — AWS Cognito user pool ID used to validate JWTs.
- `COGNITO_CLIENT_ID` — AWS Cognito app client ID for the application.
- `AWS_REGION` — AWS region where the Cognito user pool is hosted.
- `FRONTEND_URL` — Frontend origin allowed by backend CORS.
- `FRONTEND_URLS` — Optional comma-separated extra allowed origins.
- `SENTRY_DSN` — Optional Sentry DSN (Sentry SDK wired; no-op when unset).

See `.env.example` for the full list (including optional variables).

## Tenant model

At the database level:

- `Tenant` has many `Site`s and `User`s.
- `User` belongs to a `Tenant` and may optionally belong to a `Site`.
- The Cognito `sub` claim is stored as `User.cognitoId` and is the lookup key for `GET /users/me`.
- `Patient` belongs to a `Tenant` and a `Site` (both cascade-delete), with NHS number, DOB, registered GP, and a JSONB allergies array. Indexed on `(tenantId, siteId, surname)` for the typical search pattern.
- `Appointment` references `Patient`, `Site`, and a `User` for the dentist (`AppointmentStatus` enum: `scheduled / confirmed / in_progress / completed / no_show / cancelled`). Indexed on `(siteId, startsAt)` for day-view queries. The `dentistId` FK will move to `StaffMember` once VER-23 ships.

### GDPR endpoints

- `GET /users/me/export` — DSAR (data subject access request) export for the authenticated user.
- `DELETE /users/me` — soft-delete + anonymisation for the authenticated user (retention policy pending; no hard delete).

Verbilo uses three web surfaces:

- `verbilo.co.uk` for the public landing site.
- `admin.verbilo.co.uk` for the internal Verbilo admin portal.
- `{slug}.verbilo.co.uk` for tenant portals.

Tenant portals send `X-Tenant-Slug` on tenant-scoped API requests. The backend resolves that slug to a tenant context and tenant-scoped queries must still filter by the resolved tenant id server-side.

Admin tenant endpoints, protected by Verbilo support/super-admin roles:

- `POST /admin/tenants`
- `GET /admin/tenants`
- `GET /admin/tenants/check-slug?slug=foo`
- `GET /admin/tenants/:id`
- `PATCH /admin/tenants/:id`

Public tenant bootstrap:

- `GET /tenants/by-slug/:slug`

Routing-level surfaces (and the corresponding backend CORS policy):

- Production tenant surfaces use `https://<tenant-slug>.verbilo.co.uk`.
- Staging tenant surfaces use `https://<tenant-slug>.staging.verbilo.co.uk`.

## Branch and deploy model

Render deploys from branches as follows:

| Branch | Render environment | Service URL |
|---|---|---|
| `main` | Production | `https://verbilo-backend.onrender.com` |
| `dev`  | Staging    | `https://verbilo-backend-staging.onrender.com` |

Working convention:

1. Branch off latest `dev`: `git fetch && git checkout -b ogme01/ver-N-slug origin/dev`.
2. Open a PR targeting `dev` (default). Merge → Render redeploys staging.
3. Open a release PR `dev` → `main`. Merge → Render redeploys production.

Note: `verbilo-backend-staging` shares the same Cognito pool as production. The Neon staging branch is separate (`verbilo-dev` → `staging` branch).

## Branch protection

- `main`: PR required, 1 approval, dismiss stale reviews, resolved conversations, no force-push, no deletion.
- `dev`: PR required, 0 approvals (self-merge OK), no force-push, no deletion.

## Operations

Living runbook — read this before touching production.

### Local dev from scratch

1. `git clone git@github.com:verbilo-hq/verbilo-backend.git && cd verbilo-backend`
2. `npm install`
3. `cp .env.example .env` — then fill the variables (see [Environment variables](#environment-variables) above). Ask in the team chat for the Neon dev connection string and the Cognito IDs.
4. `npx prisma generate` — generates the typed client from `schema.prisma`. The `postinstall` hook also runs this; safe to repeat.
5. `npx prisma migrate dev` — applies pending migrations to your local DB. Use a personal Neon branch (`verbilo-dev/<your-name>`) so you don't trample shared staging.
6. `npm run seed` *(planned — no seed script yet; tracked separately)*. For now create a Tenant/Site/User row by hand in Prisma Studio (`npx prisma studio`).
7. `npm run start:dev` — Nest runs at `http://localhost:3000`. Confirm `GET /health` returns 200.

To impersonate a tenant locally, hit endpoints with `X-Tenant-Slug: <slug>` and a valid Cognito JWT in `Authorization: Bearer …`. See "Seeding a Cognito user" below.

### Seeding a Cognito user (CLI)

Cognito doesn't ship with a self-serve sign-up; ops creates accounts. The flow with `aws-cli` (auth via SSO or `~/.aws/credentials`):

```bash
# 1. Create the user with a temporary password
aws cognito-idp admin-create-user \
  --region eu-north-1 \
  --user-pool-id <COGNITO_USER_POOL_ID> \
  --username s.jenkins \
  --user-attributes Name=email,Value=s.jenkins@example.co.uk Name=email_verified,Value=true \
  --temporary-password 'TempPass1!' \
  --message-action SUPPRESS    # set to RESEND to email the user

# 2. Mirror the row in our DB so /users/me can find them
#    Open Prisma Studio and insert a User with:
#      cognitoId  = sub from step 1 (`User.Attributes` → `sub`)
#      username   = 's.jenkins'
#      tenantId   = whichever tenant they belong to
#      role       = 'practice_manager' (or other UserRole value)
#      siteId     = optional, the site they default to
```

The frontend's first login challenges them with `newPasswordRequired`, which our `SetPasswordPage` handles via `completeNewPasswordChallenge`.

To grant a Verbilo-staff role (so the user can hit `/admin/tenants` endpoints), set `role` to `verbilo_support` or `verbilo_super_admin` on the User row.

### Where to find logs

| Surface | Where | Notes |
|---|---|---|
| Backend stdout | Render dashboard → `verbilo-backend` (prod) / `verbilo-backend-staging` (staging) → *Logs* tab | Live tail; download via "Download logs". JSON request lines emitted by `RequestLoggerMiddleware` (VER-16). |
| Backend errors | Sentry → project `verbilo-backend` | Source-mapped stack traces. `SENTRY_DSN` must be set in Render env for prod/staging to report. |
| Frontend errors | Sentry → project `verbilo-frontend` | Set `VITE_SENTRY_DSN` in Vercel project env (per environment). |
| Frontend build / preview | Vercel dashboard → `verbilo-frontend` → *Deployments* | Click a deployment → *Build Logs* for the build, *Functions / Edge* for runtime (we don't use those yet — site is fully static + SPA). |
| Database query logs | Neon dashboard → branch → *Operations* | Slow query log + connection metrics. Neon Auto-Suspend means cold-start latency on staging — expected. |
| Audit log (in-app) | Postgres `AuditLog` table | Query via Prisma Studio or psql. Indexed on `(tenantId, createdAt DESC)` for the typical lookup. |

### Rolling back a Render deploy

Render keeps every deploy. The fastest revert:

1. Render dashboard → service → *Deploys* tab.
2. Find the last known-good deploy.
3. Click the `⋯` menu → *Rollback to this deploy*. This redeploys the existing image (no rebuild), takes ~30s.
4. If the bad deploy included a Prisma migration, **rollback alone won't revert the schema**. See "Applying / reverting a Prisma migration" below.

For staging only, an alternative is to revert the offending PR on GitHub (`gh pr revert <num>` → merge). That bakes the rollback into git history, which is preferable when the bad change is more than a few hours old.

### Applying a Prisma migration to prod

Migrations apply automatically on Render deploy via the `start` command (`prisma migrate deploy && nest start`). To apply ad-hoc from a workstation (don't, unless emergency):

```bash
# Point at the Neon prod branch (read-write connection string).
export DATABASE_URL='postgresql://…@…/verbilo?sslmode=require'
npx prisma migrate deploy
```

`prisma migrate deploy` is idempotent — it applies only pending migrations from `prisma/migrations/`. It does NOT auto-create migrations from schema drift; for that use `prisma migrate dev` locally and commit the result.

**Reverting a migration:** Prisma doesn't ship a down-migration generator. Write a forward migration that undoes the change (e.g. `DROP COLUMN`) and ship that. For destructive reverts on tables with live data, coordinate in #ops first.

**Long-running migrations** (anything that locks a hot table) — schedule for an off-peak window, raise a heads-up in chat, and consider running with `statement_timeout` set per session.

### Backups + point-in-time recovery

Neon keeps a 7-day PITR window on the free tier (longer on paid). To restore:

1. Neon dashboard → branch → *Restore branch from history*.
2. Pick a timestamp before the incident. Restoring creates a new branch — point the app at it via `DATABASE_URL` in Render env, then promote when verified.

### Contacts and ownership

| Service | Primary | Account | Notes |
|---|---|---|---|
| GitHub (`verbilo-hq`) | Owen | og2701 | Org owner. Two-factor required. |
| Vercel | Owen | og2701s-projects | `verbilo-frontend` project. |
| Render | Owen | og2701@hotmail.com | `verbilo-backend` and `verbilo-backend-staging` services. |
| Neon | Owen | og2701@hotmail.com | `verbilo-prod` and `verbilo-dev` projects. |
| Cognito | Owen | AWS account in eu-north-1 | User pool ID + client ID in `.env.example`. |
| IONOS (domain) | Hitendra (BrainPower Technologies Ltd) | bptech account | Owns `verbilo.co.uk` + `.net`. Reg-C email is `hp@bptech.co.uk`. Route 53 migration is pending (tracked separately). |
| Sentry | Owen | own org | Projects: `verbilo-backend`, `verbilo-frontend`. |
| Linear | Owen | `verbilo` workspace | All tickets prefixed `VER-`. |

When something is broken: ping in the team chat first, screenshot the error / log line, link the Render deploy ID or Sentry issue URL. Don't `kubectl`-yourself into prod (we don't have it, and that's the point).
