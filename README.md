# BushBIM

Construction collaboration for luxury resort developments across Africa: document control, field management and project administration in one place.

The workflows follow the established BIM 360 / Autodesk Construction Cloud model. BushBIM adds features users have long asked Autodesk for, plus features for remote, low-bandwidth African sites. See [docs/RESEARCH.md](docs/RESEARCH.md) for the feature research and [BACKLOG.md](BACKLOG.md) for what's next.

## Status

| Module | State |
| --- | --- |
| Project Admin: projects, members, companies, roles, service permissions, activity log, CSV bulk invite, **add one person to many projects at once** | ✅ Built |
| Document Control: Plans / Project Files folders, subfolders, multi-file upload with progress, automatic versioning (V2, V3…), version history with downloads, list/grid views with sorting | ✅ Built (item 1) |
| Document Control: folder permissions (View → Manage per user, role or company, inherited by subfolders, private folders) | ✅ Built (item 2) |
| Document Control: in-browser viewer for PDFs and images (pages, zoom), markups (pen, rectangle, cloud, arrow, text) kept private or published, scale calibration with length and area measuring, **PDF export with published markups flattened** | ✅ Built (item 3) |
| Document Control: sheets (each page of a PDF under Plans, number and title read from a configurable title-block region, editable), Sets (e.g. "Tender", "IFC Rev B") with a Folders/Sets toggle, version comparison side by side and as a red/blue overlay | ✅ Built (item 4) |
| Document Control: reviews and approval workflows (1–5 steps, reviewers by user, role or company, renameable statuses, initiators), per-file decisions with comments and markups, **auto-start on upload to a folder**, **text search**, **approved files copied to a chosen folder**, **closed reviews exported to PDF with markups** | ✅ Built (item 7) |
| Document Control: transmittals (send chosen versions to members or external emails, a no-login download link per recipient with an expiry, revoke, a log of who downloaded what and when, **text search of the log**) | ✅ Built (item 8) |
| Field Management: issues (type and subtype, assignee by user, role or company, due date, location tree, root cause, custom attributes, watchers, comments, activity), **custom statuses per project with sub-statuses**, filter panel, coloured status-bar table, CSV export; Creators edit only their own issues, assignees update status | ✅ Built (item 5) |
| Field Management: issue pins on sheets in the viewer (status-coloured, "New issue here" from the sheet), issue photos compressed in the browser to a JPEG at most 1600 px wide with thumbnails, **project photo gallery under Issues and inside Document Control** | ✅ Built (item 6) |
| Field Management (checklists, daily logs) | Backlog items 9–10 |

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
src/lib/storage.ts          file storage: presigned S3/MinIO URLs, or local disk (.storage/) when S3_BUCKET is unset
src/modules/admin/          Project Admin server actions
src/modules/issues/         Issues: access rules, statuses, filters, dates, attributes and CSV (pure + unit tested), server actions, defaults; pins and photos (media*.ts)
src/modules/transmittals/   Transmittals: recipient parsing, signed link tokens, expiry and search (pure + unit tested), server actions, public link resolver
src/modules/reviews/        Reviews: workflow/step logic (pure + unit tested), server actions, auto-start, copy approved, PDF export
src/modules/docs/           Document Control: server actions, folder permissions (pure resolver + per-request access check), folder/sort/version logic, signed upload tokens
src/app/(auth)/             login, signup, invite acceptance
src/app/(app)/projects/[projectId]/{admin,docs,reviews,transmittals,issues,field}/   modules
src/app/(public)/t/[token]  no-login transmittal download page (files via /api/t/[token]/[fileId])
```

## Permission model

- **Account admin**: owns the organisation, creates projects, and can add people across projects.
- **Project admin**: full control of one project. Has Manager level on every service.
- **Project member**: can open only the services enabled for them (Document Control, Issues, Checklists, Daily Logs). On each one they are a Viewer unless a grant to their user, role or company raises them to Creator or Manager. The highest applicable grant wins.

Document Control adds **folder permissions** on top (`src/modules/docs/folder-permissions.ts`):

| Level | Can |
| --- | --- |
| View | see the folder, its files and versions (no download) |
| View + Download | also download |
| Upload | also upload files and new versions |
| Edit | also create subfolders |
| Manage | also rename, delete and change the folder's permissions |

- With no folder grants, Viewers get View + Download and Creators get Edit everywhere.
- A grant to "Project members", a user, a role or a company applies to that folder and its subfolders until a subfolder sets its own grant for the same subject. A member's level is the highest of the grants that apply to them.
- Set "Project members" to "No access" on a folder to make it private, then grant who needs it. Project admins and Document Control Managers always have Manage.
- The Plans and Project Files roots can't be renamed or deleted.
- Sheets follow their folder's access. Editing a sheet's number or title needs Upload; creating sets and adding sheets needs Document Control Creator; deleting a set needs Document Control Manager; title-block settings are for project admins and Document Control Managers.
- In the viewer, anyone with View can open a file and add private markups. Publishing markups and setting a page's scale need Upload; deleting someone else's markup needs Manage. Export PDF is a download, so it needs View + Download. View-only people can't download the original, but the viewer still sends the file to their browser to display it.

Every module checks access through `can(member, service, action, grants)` in `src/lib/permissions.ts`.

## Deploying (Vercel + Supabase)

1. In Supabase, open **Connect** and copy two connection strings:
   - **Transaction pooler** (port 6543). Add `?pgbouncer=true&connection_limit=1&schema=bushbim` to the end.
   - **Session pooler / direct** (port 5432). Add `?schema=bushbim` to the end.
   The `bushbim` schema keeps BushBIM's tables apart from anything else in the database.
2. In the Vercel project, open **Settings → Environment Variables** and add:
   - `DATABASE_URL`: the transaction-pooler URL
   - `DIRECT_URL`: the session/direct URL
   - `SESSION_SECRET`: 32+ random characters
   - optional `SEED_DEMO=1`: loads the demo organisation (login `admin@bushbim.test` / `bushbim123`). Remove it, and change that password, before real use.
3. File storage for Document Control (required on Vercel, which has no persistent disk). Any S3-compatible bucket works, including Supabase Storage (Project Settings → Storage → S3 connection):
   - `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
   - `S3_ENDPOINT` for non-AWS providers (e.g. `https://<ref>.storage.supabase.co/storage/v1/s3`, the direct storage host, which is faster for large files); path-style addressing is then used automatically
   - The bucket must allow CORS `PUT` and `GET` from the app's origin with the `Content-Type` header, because browsers upload straight to the bucket.
4. Deploy. The `vercel-build` script runs `prisma migrate deploy` before `next build`, so the database schema is always up to date.

Reviews (`src/modules/reviews/`):

- Project admins and Document Control Managers define workflows: 1–5 steps, each with reviewers (people, roles or companies), "any one responds" or "all respond", and days to review; which of Approved / Approved with comments / Revise & resubmit / Rejected are offered and what they're called; who may start reviews (none chosen: any Document Control Creator); an optional folder whose uploads start a review automatically; and an optional folder that approved files are copied to when the review closes. Used workflows can be deactivated but not deleted.
- Starting a review needs View on every file's folder. Each step must have at least one reviewer who can open Document Control.
- A reviewer of the current step picks a status and comment for every file. A step's result for a file is the worst status it received; when the last step completes the review closes with that result.
- Reviewers open files in the viewer through their normal folder access. While they are reviewing a file they may publish markups on it even without Upload.
- A review is visible to its initiator, anyone named as a reviewer, Document Control Managers, and anyone who can view all its files. Export PDF (closed reviews) includes a file's pages only where the user has View + Download.

Transmittals (`src/modules/transmittals/`):

- Sending needs Document Control Creator and View + Download on every file's folder, because a transmittal hands files to people outside the app. Any version can be sent, not only the latest. Folder pages with files have a "Send transmittal" shortcut.
- Recipients are project members and/or any email addresses. Each one gets their own link, `/t/<recipient id>.<signature>`, which works without signing in until the expiry (1–30 days, default 14) or until the sender or a manager revokes the transmittal. The signature is an HMAC of the recipient id with `SESSION_SECRET`, so no link secret is stored in the database. Changing `SESSION_SECRET` invalidates every outstanding link.
- Email delivery arrives with backlog item 13. Until then the sender copies each recipient's link from the transmittal page.
- Every download through a link is recorded (recipient, file and version, time), along with when each recipient first opened their link. A download by a project member also goes in the activity log. External recipients have no user account, so their downloads are recorded only in the transmittal log.
- The log and each transmittal are visible to the sender, project admins, Document Control Managers, and member recipients. Member recipients see only their own link and downloads. The log searches subject, message, file names, sender and recipients, and `T-n` numbers.
- File names and version numbers are copied into the transmittal, so the log still reads correctly if a file is deleted later. The file then shows as no longer available.

Issues (`src/modules/issues/`):

- Viewers see issues and can comment and watch. Creators also raise issues, and edit every field of the issues **they created**. Issues Managers (and project admins) edit any issue and open **Settings**.
- The assignee (the user, any member of the role, or anyone in the company) can change an issue's status even as a Viewer, with an optional comment.
- ⭐ Statuses are per project. Each project starts with Draft, Open, Answered, Work completed, Ready to inspect, Not approved, In dispute, Closed and Void; Managers can rename, recolour, reorder and add statuses, nest one level of sub-statuses (filtering on a status includes its sub-statuses), and choose the status new issues start in. A **closed** status stamps `closedAt` and stops the overdue flag; issues in a **draft** status are visible only to their creator and Managers. A status in use can't be deleted.
- Managers also maintain types and subtypes (deactivated ones stay on existing issues), root causes, custom attributes (list, text, number or date) and the location tree (Site › Zone › Villa › Room; CSV import comes with backlog item 16).
- The list has a text/#ID search and a filter panel (type, status, created by, created on, assignee, custom attributes). Export CSV downloads exactly the filtered list, with custom attributes as extra columns; cells that a spreadsheet would treat as formulas are prefixed with `'`.
- Due and created-on dates follow the project's time zone. Every change is in the issue's activity panel and the project activity log.
- **Pins**: the viewer's *Pin issue* tool places an issue on a page of a sheet (one pin per issue; pinning again moves it), or starts *New issue here* already pinned. Pins take the issue's status colour (faded once closed) and link to the issue; the issue shows "Open sheet at pin". Pinning needs edit rights on the issue and View on the sheet's folder; pins only show to people who can see the issue.
- **Photos**: added on an issue (its Creators/Managers or assignee) or to the project gallery (Issues or Document Control Creators). The browser re-encodes each photo as a JPEG at most 1600 px wide plus a 320 px thumbnail before upload; the server checks the stored files really are JPEGs within those widths. ⭐ The gallery (*Photos*) appears under Issues and inside Document Control, filtered to photos on issues the member can see plus project photos. The uploader or a Manager can delete a photo.
