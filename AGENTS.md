# Verbilo Backend Agent Guide

This file is the working guide for AI agents and contributors in this repository. Follow it unless a newer user instruction explicitly overrides it.

## Branch and Deploy Model

See `README.md` for the canonical workflow and deployment model. In short: feature branches branch off `dev`, PRs target `dev`, and release PRs go `dev` → `main`. Render staging is `https://verbilo-backend-staging.onrender.com`.

## Project Context

- App: Verbilo, a multi-tenant intranet SaaS for UK dental group practices.
- Repository: NestJS API deployed to Render.
- Database: Neon PostgreSQL accessed through Prisma.
- Authentication: AWS Cognito JWT validation via JWKS. The frontend sends Cognito ID tokens as `Authorization: Bearer <token>`.

## Commands

- Install dependencies: `npm install`
- Start local dev server: `npm run start:dev`
- Production build: `npm run build`
- Production start: `npm run start:prod`
- Prisma validate: `npx prisma validate`
- Prisma generate: `npx prisma generate`
- Seed local/dev database: `SEED_USERNAME=<username> SEED_COGNITO_SUB=<uuid> npm run seed`

Run `npm run build` after source changes. For Prisma schema changes, also run `npx prisma validate`. Documentation-only changes do not require a build.

## Environment Variables

Use `.env` locally. Do not commit `.env` or any real secret values.

Required or supported variables:

- `DATABASE_URL`: Neon/PostgreSQL connection string. Required by Prisma commands and runtime database access.
- `COGNITO_USER_POOL_ID`: Cognito user pool id used by JWT validation.
- `COGNITO_CLIENT_ID`: Cognito app client id. Documented for consistency with frontend/client setup.
- `AWS_REGION`: Cognito region. Current dev pool uses `eu-north-1`.
- `FRONTEND_URL`: Primary allowed frontend origin for CORS.
- `FRONTEND_URLS`: Optional comma-separated extra allowed frontend origins.
- `SENTRY_DSN`: Optional Sentry DSN.
- `PORT`: Runtime port. Render injects this automatically in production.

Seed-only variables:

- `SEED_TENANT_NAME`: Optional; defaults to `Verbilo Dev Tenant`.
- `SEED_SITE_NAME`: Optional; defaults to `Dev Site`.
- `SEED_USERNAME`: Required for `npm run seed`.
- `SEED_COGNITO_SUB`: Required for `npm run seed`; must match the Cognito user `sub` claim.

All runtime config should be read via Nest `ConfigService` (validated by `src/config/env.schema.ts`). Only pre-boot code (e.g. `src/instrument.ts`) and standalone scripts (e.g. `prisma/seed.ts`) should read `process.env` directly. Do not hardcode pool ids, URLs, connection strings, or origins in source files.

## Authentication Conventions

- JWT validation lives in `src/auth/jwt.strategy.ts`.
- The strategy reads Cognito region and pool id from env and validates against the Cognito JWKS endpoint.
- Protected routes should use `JwtAuthGuard` from `src/auth/jwt-auth.guard.ts`.
- `validate()` currently returns the decoded JWT payload directly.
- Do not add `token_use` or `aud` validation unless the user explicitly requests that hardening pass.

The current protected user endpoint is `GET /users/me`:

- No token: returns 401.
- Valid token with no matching Prisma user row: returns 404.
- Valid token with matching user: returns the Prisma user including `tenant` and `site` relations.

The lookup key is the Cognito `sub` claim mapped to `User.cognitoId`.

## Prisma And Database Conventions

- Prisma schema is `prisma/schema.prisma`.
- Prisma client is exposed through `src/prisma/prisma.service.ts` and `src/prisma/prisma.module.ts`.
- `PrismaModule` is global; inject `PrismaService` instead of constructing new Prisma clients in Nest providers.
- `prisma/seed.ts` is a standalone TypeScript script and must not depend on Nest dependency injection.
- Keep seed behavior idempotent. Re-running the seed should not duplicate Tenant, Site, or User rows.
- Keep migration history committed. Do not delete or rewrite existing migrations unless the user explicitly asks and understands the database impact.

This project is on Prisma 6.x. Do not upgrade to Prisma 7 casually; Prisma 7 requires config changes and no longer supports the same classic datasource URL pattern without migration work.

The `postinstall` script must run `prisma generate` so Render produces Prisma client files during deploy installs.

## Build And Render Conventions

- Deployment target: Render.
- `npm run build` should emit `dist/main.js`.
- `npm run start:prod` runs `node dist/main`.
- `tsconfig.build.json` intentionally excludes `prisma` and includes only `src/**/*.ts` so `prisma/seed.ts` does not move build output to `dist/src/main.js`.
- After build config changes, verify `dist/main.js` exists at the root of `dist/`.
- Do not add `render.yaml` unless there is a concrete deployment requirement.
- The default `GET /` route is enough for basic Render health checks for now.

## CORS Conventions

- CORS is configured in `src/main.ts`.
- Keep the explicit allowlist approach. Do not use wildcard origins for production.
- Local frontend origin `http://localhost:5173` should remain allowed.
- Production frontend origins should come from env or the existing explicit allowlist.
- If adding more production domains, normalize trailing slashes so env formatting does not break preflight requests.

## NestJS Code Style

- Follow the existing Nest module/service/controller structure.
- Keep controllers thin; put business/database logic in services when behavior grows beyond a narrow endpoint.
- Use dependency injection for shared services.
- Keep route behavior explicit with Nest exceptions such as `NotFoundException` and guards such as `JwtAuthGuard`.
- Env validation uses `@nestjs/config` + Zod in `src/config/env.schema.ts`; add new runtime env vars there.
- Do not add broad infrastructure packages such as global validation, helmet, compression, or health modules unless requested.
- Avoid DTOs/serializers until the route surface needs them or the user asks for them.

## Git And File Hygiene

- Do not commit `.env`, `node_modules`, `dist`, generated Prisma client files, or local logs.
- Keep `package-lock.json` changes only when dependency or npm metadata changes require them.
- Keep backend commits separate from frontend commits. These are separate repos.
- Before committing, check `git status` and review the diff for secrets or unrelated edits.

## Known Out-Of-Scope Areas Unless Requested

- Do not add MFA, self-signup, Cognito hosted UI, or Cognito admin APIs.
- Do not add token audience/type validation unless requested.
- `/health` is part of the canonical surface (Render health checks) and must stay unauthenticated and lightweight.
- Do not replace Prisma with another ORM or bypass Prisma for regular application queries.
- Do not change `/users/me` response shape unless coordinating the frontend session enrichment contract.
