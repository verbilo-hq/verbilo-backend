# Verbilo Backend

## Overview

NestJS API for Verbilo.

## Tech Stack

- NestJS
- Prisma
- Neon PostgreSQL
- AWS Cognito

## Local Setup

```bash
npm install
cp .env.example .env
```

Fill in the values in `.env`, then start the development server:

```bash
npm run start:dev
```

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string for the Neon database.
- `COGNITO_USER_POOL_ID` - AWS Cognito user pool ID used to validate JWTs.
- `COGNITO_CLIENT_ID` - AWS Cognito app client ID for the application.
- `AWS_REGION` - AWS region where the Cognito user pool is hosted.
- `SENTRY_DSN` - Sentry DSN for backend error monitoring.
- `FRONTEND_URL` - Frontend origin allowed by backend CORS.

## Tenant model

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
