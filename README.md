# StudyFlow

StudyFlow is a calm, local-first study planner built around a scheduling engine. The UI stays focused on one question: what should I study right now?

Version `1.0.0` ships with:

- Engine-driven home screen states for study, break, free time, completed day, loading, empty, and error flows
- Local-first persistence with IndexedDB
- Background sync queue for Cloudflare Worker and D1 persistence
- Thin REST API hosted on Cloudflare Workers
- Installable PWA shell with offline caching
- Natural, light, and dark themes

## Tech Stack

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS 4
- Motion
- Zustand
- Drizzle ORM
- Cloudflare Workers
- Cloudflare D1

## Project Structure

```text
app/                Next.js app shell and route entrypoints
components/         Reusable UI, layout, study, and shared runtime components
lib/engine/         Scheduling engine and engine-facing view helpers
store/              Client state coordination between engine and UI
storage/            IndexedDB models and browser persistence helpers
sync/               Background synchronization queue
repositories/       Local and D1 persistence adapters
workers/            Cloudflare Worker API entrypoint
db/                 Drizzle schema, migrations, and seed data
public/             Manifest, service worker, icons, and static headers
```

## Local Development

### Prerequisites

- Node.js 22+
- npm 10+
- Cloudflare account with D1 enabled for backend deployment

### Install

```bash
npm install
```

### Run the frontend

```bash
npm run dev
```

The Next.js app runs locally and stores user progress in IndexedDB first. If `NEXT_PUBLIC_STUDYFLOW_API_URL` is unset, sync requests target `/api` on the same origin.

Cloudflare tooling in this repository expects Node 22 or newer.

### Verify the project

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## Environment Variables

Copy values from `.env.example` into `.env.local` for local work.

```bash
NEXT_PUBLIC_STUDYFLOW_APP_URL=
NEXT_PUBLIC_STUDYFLOW_API_URL=
CLOUDFLARE_D1_DATABASE_ID=
```

- `NEXT_PUBLIC_STUDYFLOW_APP_URL`
  Base URL of the deployed frontend.
- `NEXT_PUBLIC_STUDYFLOW_API_URL`
  Optional absolute URL for the deployed Worker API.
- `CLOUDFLARE_D1_DATABASE_ID`
  D1 database identifier used by Wrangler.

## Database Setup

Generate Drizzle artifacts if the schema changes:

```bash
npm run db:generate
```

Apply D1 migrations:

```bash
npm run db:migrate
```

Wrangler reads the D1 binding from `wrangler.toml` at deploy time. Update the placeholder `database_id` before production deployment.

## Deployment

### Cloudflare Pages

StudyFlow is configured for static export:

```bash
npm run build
```

Deploy the generated `out/` directory to Cloudflare Pages:

```bash
npm run deploy:pages
```

### Cloudflare Worker API

Deploy the sync/API worker separately:

```bash
npm run deploy:worker
```

Bind the deployed Worker to an `/api/*` route or provide its full URL through `NEXT_PUBLIC_STUDYFLOW_API_URL`.

## PWA

The production build includes:

- `public/manifest.webmanifest`
- `public/sw.js`
- installable app icons
- static response headers for Cloudflare Pages

The service worker caches the app shell for repeat visits and offline launch support.

## Release Notes

See `CHANGELOG.md` for the v1.0 release summary.

## License

StudyFlow is licensed under the MIT License. See `LICENSE`.
