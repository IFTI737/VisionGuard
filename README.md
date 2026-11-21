# VisionGuard

VisionGuard "Digital Watcher" turns ordinary CCTV cameras into an AI watcher that detects problems, alerts the right people, and keeps calling until someone responds.

Backend API built with NestJS, TypeORM, PostgreSQL and Redis.

## Run locally

```bash
cp .env.example .env     # then set your PostgreSQL password
pnpm install
pnpm migration:run
pnpm seed
pnpm start:dev
```

The API runs at `http://localhost:5001/v1`. Postman collection: `test/postman`.
