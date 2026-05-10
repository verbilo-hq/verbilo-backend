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
| Alerting / errors | Sentry (planned — projects exist but the SDK isn't initialised in either repo; see VER-15 / VER-35). |

## Local setup

```bash
npm install
cp .env.example .env
npm run start:dev
```

## Environment variables

See `.env.example` for the complete list (including optional variables). Required for a working local dev server:

- `DATABASE_URL`
- `AWS_REGION`
- `COGNITO_USER_POOL_ID`
- `COGNITO_CLIENT_ID`
- `FRONTEND_URL`

## Tenant model

At the database level:

- `Tenant` has many `Site`s and `User`s.
- `User` belongs to a `Tenant` and may optionally belong to a `Site`.
- The Cognito `sub` claim is stored as `User.cognitoId` and is the lookup key for `GET /users/me`.

At the frontend routing level (and corresponding backend CORS policy):

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

Note: `verbilo-backend-staging` shares the same Neon DB and Cognito pool as production for now. Plan to split before first paying tenant (tracked separately).

## Branch protection

- `main`: PR required, 1 approval, dismiss stale reviews, resolved conversations, no force-push, no deletion.
- `dev`: PR required, 0 approvals (self-merge OK), no force-push, no deletion.
