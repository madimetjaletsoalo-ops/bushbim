# BushBIM backlog

The nightly routine takes the **first unchecked item** and builds it end to end: schema, actions, UI, tests. It then ticks the box, adds the date and a one-line note, and commits. Items marked ⭐ are differentiators: things Autodesk users have asked for that are still unshipped (see docs/RESEARCH.md).

The product owner can reorder, add or delete items at any time. Write each new item in the same format: a title, then "Done when" criteria.

## Done

- [x] **0. Foundation + Project Admin** (2026-11-22). Next.js/Prisma scaffold, auth (sign-up, sign-in, invite links), projects, members (add/edit/remove), companies, roles, per-service permissions (user/role/company), activity log, CSV bulk invite with duplicate detection ⭐, add one person to many projects ⭐.

## Document Control

- [ ] **1. Folders, upload and versions**
  Done when: each project starts with a "Plans" and a "Project Files" root; users can create, rename and delete subfolders; upload files (presigned S3/MinIO, multiple files, progress bar); a new upload with the same name stacks as V2, V3…; the version history drawer can download any version; the list/grid views (as in the reference screenshot) sort by name, date and size; the left folder tree expands and collapses; access is gated by `can(member, "DOCS", …)`.
- [ ] **2. Folder permissions**
  Done when: levels View → View+Download → Upload → Edit → Manage can be granted per folder to a user, role or company; they are inherited by subfolders unless overridden; enforcement happens server-side on every docs action; the folder settings show who has access.
- [ ] **3. Viewer and markups**
  Done when: PDFs and images open in the browser viewer (pdf.js) with page navigation and zoom; markups (pen, rectangle, cloud, arrow, text) can be private or published; the scale can be calibrated and length and area measured; ⭐ a sheet can be exported as a PDF with its published markups flattened.
- [ ] **4. Sheets and Sets**
  Done when: a multi-page PDF uploaded to Plans is split into sheets; sheet number and title are taken from a configurable title-block region (editable); sheets are grouped into Sets ("Tender", "IFC Rev B"), and the Folders/Sets toggle from the screenshot works; version comparison shows two versions side by side and as an overlay.
- [ ] **7. Reviews and approval workflows**
  Done when: admins define workflows (1–5 steps, reviewers per step, approval statuses, initiators); files are submitted for review; each reviewer marks Approved, Approved with comments, Revise & resubmit or Rejected, with comments and markups; reviews can auto-start on upload to a chosen folder; ⭐ reviews have a text search; ⭐ an optional "move approved files to folder X" step; ⭐ a closed review can be exported with its markups.
- [ ] **8. Transmittals**
  Done when: users can send selected document versions to members or external email addresses; recipients get a no-login download link with an expiry; the transmittal log records who downloaded what and when; ⭐ the log has a text search.

## Field Management

- [ ] **5. Issues** ⭐ custom statuses
  Done when: issues have a title, description, type and subtype (admin-configurable), status, assignee (user, company or role), due date, location (project location tree), root cause, watchers and comments; ⭐ statuses are configurable per project (rename, add, sub-statuses) with the default set Draft, Open, Answered, Work completed, Ready to inspect, Not approved, In dispute, Closed, Void; the filter panel offers type, status (multi-select), created by, created on, assignee and custom attributes; the table has a coloured status bar, ID, type and title, as in the reference screenshot; CSV export works; Creator/Manager rules apply (a Creator edits only their own issues).
- [ ] **6. Issue pins and photos**
  Done when: issues can be pinned on a sheet in the viewer, and pins show status colour; photos are attached to issues and compressed client-side to at most 1600 px wide JPEG; a photo gallery lists photos per project ⭐ (photos also inside Docs).
- [ ] **9. Checklists**
  Done when: a template builder supports sections and items (yes/no/N/A, text, number, date, signature, photo); checklists are created from templates, assigned to a user or company, and linked to a location; completing a checklist records who and when; a failed item can raise an issue with one click; a PDF of the result can be produced; starter templates are included: "Villa handover snag list (luxury finishes)", "Thatch roof inspection", "Pool commissioning".
- [ ] **10. Daily Logs** ⭐ customisable
  Done when: there is one log per project per day, with weather (auto from Open-Meteo using project coordinates, editable), labour rows (company, headcount, hours), equipment, visitors, notes and photos; ⭐ admins can add custom checklist items to the log template; ⭐ the work log can be made mandatory; ⭐ subcontractors can contribute their own labour/work section; publishing locks the log, it can be reopened within 24 h, and after that only by admins; the log exports to PDF.

## Platform

- [ ] **11. Full-text search** ⭐
  Done when: text from uploaded PDFs (OCR for scanned PDFs via tesseract), DOCX and XLSX is extracted in a background job and indexed (Postgres `tsvector`); global search covers documents, issues, reviews and transmittals; ⭐ searches can use a regex or naming-pattern filter.
- [ ] **12. Offline PWA and WhatsApp** ⭐
  Done when: the app is installable; the sheets and issues a user opened recently work offline; issues, checklist answers and photos created offline sync when back online, with conflict notices; notifications can go out by WhatsApp (Cloud API, opt-in per user) as well as email.
- [ ] **13. Email notifications and invites**
  Done when: invites and assignments send email (SMTP/Resend via env); each user has a daily digest preference.
- [ ] **14. Reports and exports**
  Done when: there are an issue summary (by status, company and location), checklist completion and daily log range reports as PDF/CSV, and a project dashboard with counts.
- [ ] **15. Project templates**
  Done when: a project can be created from a template that copies its folders, roles, permissions, issue types/statuses and checklist templates.
- [ ] **16. Locations tree**
  Done when: the resort hierarchy Site → Zone → Villa/Suite → Room can be built and imported from CSV, and is used by issues, checklists and photos.
- [ ] **17. Holding area per folder** ⭐
  Done when: an optional quarantine can be set per folder, so uploads wait for a document controller to approve them before publishing.
