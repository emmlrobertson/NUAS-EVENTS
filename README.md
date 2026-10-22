# NUAS KNUST Dinner & Awards Night Platform

Full-stack platform for the NUAS KNUST Dinner and Awards Night (21 November 2026).  
Built with Next.js (App Router, TypeScript), PostgreSQL, and Prisma ORM.

---

## 1. Prerequisites

- **Node.js**: v18.17.0+ (Tested on v22)
- **PostgreSQL**: 15+ (Running locally or hosted)
- **npm**: 9+

---

## 2. Environment Setup

1. Copy the example environment template:
   ```bash
   cp .env.example .env
   ```
2. Configure your local PostgreSQL database URL and session secret in `.env`:
   ```bash
   DATABASE_URL="postgresql://[USER]:[PASSWORD]@localhost:5432/nuas_awards_dev?schema=public"
   TEST_DATABASE_URL="postgresql://[USER]:[PASSWORD]@localhost:5432/nuas_awards_test?schema=public"
   SESSION_SECRET="your-secure-development-session-secret"
   ```
   > **Note:** `.env` is strictly ignored by `.gitignore` and must never be committed.

---

## 3. Database Migration & Seeding

### Apply Schema Migrations
Apply version-controlled Prisma migrations:
```bash
npx prisma migrate dev
```
For the test database:
```bash
$env:DATABASE_URL="postgresql://[USER]:[PASSWORD]@localhost:5432/nuas_awards_test?schema=public"
npx prisma migrate deploy
```

### Initial Administrator Provisioning
Safely provisions the Super Administrator reading `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` from `.env`. Safe to rerun without overwriting existing passwords:
```bash
npm run seed:admin
```
To explicitly reset an existing administrator password via CLI:
```bash
npm run seed:admin -- --force-reset
```

### Development Demo Data Seeding
Populates demo categories, nominees, and ticket types in `DRAFT` status:
```bash
npm run seed:dev
```
> **Safety Notice:** Development seed data is strictly flagged as `DRAFT` and marked with `[DEMO / TEST DATA]`. It will refuse to run if `NODE_ENV=production`.

---

## 4. Verification & Testing

### Run Automated Tests (Vitest)
Executes environment validation, admin bootstrap idempotency, health check, and schema constraint tests:
```bash
npm test
```

### Run TypeScript Verification
```bash
npm run typecheck
```

### Run ESLint
```bash
npm run lint
```

### Run Production Build Verification
```bash
npm run build
```

### Run Local Development Server
```bash
npm run dev
```
Access the application at `http://localhost:3000` and the health endpoint at `http://localhost:3000/api/health`.

---

## 5. Security Architecture Notes

1. **Integer Pesewas:** All monetary amounts are handled and stored as 64-bit integer Ghanaian Pesewas (GH₵1.50 = `150` pesewas). Client-submitted amounts are never trusted.
2. **Payment Idempotency:** Bound by deterministic `idempotencyKey` and `[gateway, gatewayReference]` unique constraint to prevent duplicate crediting.
3. **Decoupled Outbox:** Email delivery failures log to `EmailOutbox` for background retries and never alter payment or ticket issuance state.
4. **No Public Admin Signups:** Administrator accounts cannot be created via public HTTP registration.
