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
