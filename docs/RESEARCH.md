# Feature research: BIM 360 / Autodesk Construction Cloud → BushBIM

_Researched 22 Nov 2026._

## Where Autodesk is today

- BIM 360 is the legacy platform. Autodesk moved it to **Autodesk Construction Cloud (ACC)**, and in 2025–26 rebranded ACC as **Autodesk Forma**: Docs became *Forma Data Management* and Build became *Forma Build*. A lighter *Forma Build Essentials* tier covers Issues, Forms, photos, sheets, files and daily reports.
- BIM 360 Glue and BIM 360 Plan reach end of life on **31 Jul 2026**. BIM 360 customers are being pushed to migrate, which makes this a good time to offer an alternative.
- Recent ACC releases (Jan 2026, 40+ updates): review auto-triggers with conditions (status, file type), approvers editable during a review, renaming closed reviews, a Transmittal public API, linking issues to forms/submittals/PCOs, and auto thumbnails for 2D issues.

## Features to replicate

### Project Admin (project management)
- Projects with location, type, dates, currency and timezone
- Members: invite by email, access level (project admin / member), company, role(s), enabled services
- Companies (trades) and roles shared across the account
- Per-service permissions (Viewer / Creator / Manager) granted to a user, role or company
- Project templates (folders, roles, checklist templates, workflows)
- Activity/audit log

### Document Control
- Folder tree with a **Plans** area (published sheets) and **Project Files**; grid and list views; sort and filter
- Folder permissions, from lowest to highest: View → View + Download → Upload → Edit → Manage. Granted to a user, role or company
- Version stacking (V1, V2, …), version history, side-by-side or overlay comparison
- PDF sheet splitting, title-block extraction (sheet number and name), **Sets** (Tender, IFC Rev B, …)
- Viewer with markups (private or published), measuring, and hyperlinks between sheets
- Naming standards, custom attributes, document status
- **Reviews** with approval workflows: 1–5 steps, reviewers per step, approval statuses, auto-start on upload
- **Transmittals** to internal or external recipients, with a log and download receipts
- Search, bulk zip download, share links, activity log

### Field Management
- **Issues**: type and subtype, statuses (Draft, Open, Answered, Work completed, Ready to inspect, Not approved, In dispute, Closed, Void), assignee (user, company or role), due date, location, root cause, photos, comments, pins on sheets, custom attributes, a filter panel, CSV/PDF export
- **Checklists**: templates (sections; yes/no/N/A, text, number, signature and photo items), assignment, completion on mobile, failed items raise issues
- **Daily Logs**: weather, labour per company (headcount and hours), equipment, notes, photos. Publishing locks the log; it can be reopened within 24 h, and after that only by an admin
- Photos library, locations tree, equipment/assets, reports

## Requested from Autodesk but still not shipped (our differentiators)

| # | Request | Evidence |
|---|---|---|
| 1 | Add one user to many projects at once | Long-running thread on the BIM 360 and ACC ideas boards; still open. **BushBIM: built.** |
| 2 | Custom or renamable issue statuses and sub-statuses | ACC ideas: "Allow customisable statuses in Issues". Autodesk says it is architecturally difficult |
| 3 | Full-text search inside documents (PDF OCR, Office, DWG text), plus regex/naming-pattern search | ACC ideas board |
| 4 | Text search in Reviews and Transmittals | Autodesk support article: not possible, filters only |
| 5 | Export drawings with markups after a review closes | ACC ideas board |
| 6 | "Move approved file" when a review is approved, instead of copying it | ACC ideas board |
| 7 | Customisable daily logs: checklist items, required work log (headcount per trade), a standalone log subcontractors can add to | ACC ideas: "Customizable Daily Logs", "Separate Daily Log Tool" |
| 8 | Holding area / upload quarantine set per folder, not just globally | ACC ideas board |
| 9 | Create and edit Office files in the browser | ACC ideas board |
| 10 | Photos in Docs (they exist only in Build) | ACC ideas board |
| 11 | Real offline mode; good performance on large projects and slow links | Most frequent complaint in G2/Capterra reviews (sync, speed, connectivity) |
| 12 | Duplicate validation on bulk spreadsheet imports | ACC ideas board. **BushBIM: CSV invite flags duplicates.** |

The ACC ideas board had around 4,900 ideas "gathering support" against about 70 "implemented", so few requests get built.

## Africa / luxury-resort additions

- Offline-first PWA with background sync; images compressed client-side for low-bandwidth sites
- WhatsApp notifications and share links (more reliable than email on many African sites)
- POPIA-friendly data residency (AWS `af-south-1`, Cape Town)
- Multi-currency (ZAR, USD, BWP, KES, TZS, …) and African timezones per project
- Location tree suited to resorts: Site → Zone → Villa/Suite → Room
- Luxury handover: FF&E and finishes snag lists, guest-ready sign-off checklists

## Sources

- Autodesk Construction blog: January 2026 ACC releases; Forma Build Essentials field workflows
- help.autodesk.com: BIM 360 "Workflow: Document Management"; "Field Management" overview
- Autodesk support: daily log reopen window (24 h); no text search in Reviews/Transmittals; Daily Logs service permissions (Viewer/Creator/Manager)
- Autodesk Community, Forma for Construction (ACC) Ideas: customisable issue statuses, customizable daily logs, separate daily log tool, bulk add users to projects, Office integration, full-text search
- Autodesk retired-products and end-of-life FAQs (BIM 360 Glue, BIM 360 Plan)
- G2 and Capterra reviews of Autodesk Construction Cloud / Forma / Build
