# BushBIM

Construction collaboration for luxury resort developments across Africa: document control, field management and project administration in one place.

The workflows follow the established BIM 360 / Autodesk Construction Cloud model. BushBIM adds features users have long asked Autodesk for, plus features for remote, low-bandwidth African sites. See [docs/RESEARCH.md](docs/RESEARCH.md) for the feature research and [BACKLOG.md](BACKLOG.md) for what's next.

## Status

| Module | State |
| --- | --- |
| Project Admin: projects, members, companies, roles, service permissions, activity log, CSV bulk invite, **add one person to many projects at once** | ✅ Built |
| Document Control | Backlog items 1–4, 7–8 |
| Field Management (issues, checklists, daily logs) | Backlog items 5–6, 9–10 |

## Stack

Next.js 15 (App Router, server actions) · TypeScript · Tailwind CSS 4 · PostgreSQL + Prisma · signed-cookie sessions (`jose` + `bcryptjs`) · Zod · Vitest · Playwright.

## Getting started

```bash
cp .env.example .env            # then set SESSION_SECRET
docker compose up -d            # Postgres (+ MinIO for later)
npm install
npx prisma migrate dev
npm run seed                    # demo org: admin@bushbim.test / bushbim123
npm run dev                     # http://localhost:3000
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` · `npm run typecheck` | ESLint · `tsc --noEmit` |
| `npm test` | Vitest unit tests (`tests/unit`) |
| `npm run e2e` | Playwright end-to-end (`tests/e2e`); needs `npm run build` first. Set `CHROMIUM_PATH` to use a preinstalled Chromium. |
| `npm run seed` | Demo data |

## Layout

```
prisma/schema.prisma        data model
src/lib/permissions.ts      single permission model (can / effectiveLevel), pure + unit tested
src/lib/auth.ts             current user, project context, admin guards
src/lib/session.ts          signed session cookie
src/modules/admin/          Project Admin server actions
src/app/(auth)/             login, signup, invite acceptance
src/app/(app)/projects/[projectId]/{admin,docs,field}/   modules
```

## Permission model

- **Account admin**: owns the organisation, creates projects, and can add people across projects.
- **Project admin**: full control of one project. Has Manager level on every service.
- **Project member**: can open only the services enabled for them (Document Control, Issues, Checklists, Daily Logs). On each one they are a Viewer unless a grant to their user, role or company raises them to Creator or Manager. The highest applicable grant wins.

Every module checks access through `can(member, service, action, grants)` in `src/lib/permissions.ts`.
