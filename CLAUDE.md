# BushBIM: notes for Claude

BushBIM is a construction collaboration platform for African luxury resort developers. It covers document control, field management and project admin, with workflows modelled on BIM 360 / Autodesk Construction Cloud. Use our own name, branding and UI. Never use Autodesk names, logos or icons in the product.

## Nightly routine
1. Read `BACKLOG.md` and take the first unchecked item. Build all of it; don't half-finish several items.
2. Follow the existing patterns: Prisma models in `prisma/schema.prisma` with a new migration (`npx prisma migrate dev --name <item>`); server actions in `src/modules/<module>/actions.ts`; pages under `src/app/(app)/projects/[projectId]/<module>/`; shared UI class strings in `src/components/ui.ts`; forms through `ActionForm` and `SubmitButton`.
3. Every server action re-checks access: `requireProjectAdmin` or `getProjectContext` plus `can(member, service, action, grants)` from `src/lib/permissions.ts`. Validate input with Zod. Write an `AuditEvent` for each mutation.
4. Before committing, all of these must pass: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run e2e`. Add unit tests for pure logic and extend the Playwright spec (or add one) for the new workflow.
5. Tick the item in `BACKLOG.md` with the date and a one-line note, update the README status table, and commit with a clear message.

### Delivery: one PR per night
- Choosing a base: list open PRs into `main` whose titles start with `Nightly:`. If one is still unmerged, branch from the newest one (stacked), and skip any item already covered by an open nightly PR. Otherwise branch from `main`.
- Push to the session's designated branch and open a PR into `main` titled `Nightly: <n>. <item title>`. The body covers what was built, the results of each check, and `Depends on <PR link>` when stacked.
- If the item can't be finished, or checks fail and can't be fixed, open a **draft** PR that explains the blocker, and leave the item unticked.
- One item per night. Never merge, force-push, or skip or disable tests. The product owner reviews and merges.

## Local setup in a fresh container
- Postgres: `service postgresql start`, then create the user/db `bushbim`/`bushbim` (see `.env.example`), or run `docker compose up -d`.
- e2e: `CHROMIUM_PATH=/opt/pw-browsers/chromium npm run e2e` when a preinstalled Chromium exists.

## Production (Vercel + Supabase)
- Merging into `main` deploys production. The build runs `prisma migrate deploy` against the live Supabase database (the `bushbim` schema, `bushbim_app` role), so every migration must be safe to apply to existing data: add columns as nullable or with defaults, never drop or rename without a data step.
- Tables live in the `bushbim` schema, never `public`. Local `.env` uses `schema=bushbim` so generated SQL matches production. Before committing, check that a new migration doesn't reference `"public".`.

## Conventions
- Default currency ZAR and timezone Africa/Johannesburg, both configurable per project. Keep pages usable at phone width (site teams use phones).
- Keep payloads small and compress images client-side: users are often on slow rural connections.
