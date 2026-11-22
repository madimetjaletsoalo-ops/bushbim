# BushBIM: notes for Claude

BushBIM is a construction collaboration platform for African luxury resort developers. It covers document control, field management and project admin, with workflows modelled on BIM 360 / Autodesk Construction Cloud. Use our own name, branding and UI. Never use Autodesk names, logos or icons in the product.

## Nightly routine
1. Read `BACKLOG.md` and take the first unchecked item. Build all of it; don't half-finish several items.
2. Follow the existing patterns: Prisma models in `prisma/schema.prisma` with a new migration (`npx prisma migrate dev --name <item>`); server actions in `src/modules/<module>/actions.ts`; pages under `src/app/(app)/projects/[projectId]/<module>/`; shared UI class strings in `src/components/ui.ts`; forms through `ActionForm` and `SubmitButton`.
3. Every server action re-checks access: `requireProjectAdmin` or `getProjectContext` plus `can(member, service, action, grants)` from `src/lib/permissions.ts`. Validate input with Zod. Write an `AuditEvent` for each mutation.
4. Before committing, all of these must pass: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run e2e`. Add unit tests for pure logic and extend the Playwright spec (or add one) for the new workflow.
5. Tick the item in `BACKLOG.md` with the date and a one-line note, update the README status table, and commit with a clear message.

## Local setup in a fresh container
- Postgres: `service postgresql start`, then create the user/db `bushbim`/`bushbim` (see `.env.example`), or run `docker compose up -d`.
- e2e: `CHROMIUM_PATH=/opt/pw-browsers/chromium npm run e2e` when a preinstalled Chromium exists.

## Conventions
- Default currency ZAR and timezone Africa/Johannesburg, both configurable per project. Keep pages usable at phone width (site teams use phones).
- Keep payloads small and compress images client-side: users are often on slow rural connections.
