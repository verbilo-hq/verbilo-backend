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

## Local setup

```bash
npm install
cp .env.example .env
npm run start:dev
```

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
