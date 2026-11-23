import Link from "next/link";
import { badge, btn, btnGhost, card, input, td, th } from "@/components/ui";
import { db } from "@/lib/db";
import { getDocsContext } from "@/modules/docs/access";
import { OUTCOME_BADGE, labelFor, matchesSearch, matchesSubject, parseStatuses, searchTerms, type Outcome } from "@/modules/reviews/logic";
import { canSeeReview, toStepDef } from "@/modules/reviews/server";

type Search = { q?: string; status?: string };

export default async function ReviewsPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<Search> }) {
  const { projectId } = await params;
  const sp = await searchParams;
  const ctx = await getDocsContext(projectId);
  const status = sp.status === "OPEN" || sp.status === "CLOSED" ? sp.status : "ALL";
  const q = (sp.q ?? "").slice(0, 200);
  const terms = searchTerms(q);

  const rows = await db.review.findMany({
    where: { projectId, ...(status !== "ALL" ? { status } : {}) },
    include: {
      workflow: { select: { name: true, statuses: true, steps: { orderBy: { order: "asc" } } } },
      initiator: { select: { name: true } },
      documents: { select: { outcome: true, version: { select: { number: true, document: { select: { name: true, folderId: true } } } } } },
      decisions: { select: { comment: true, reviewer: { select: { name: true } } } },
    },
    orderBy: { number: "desc" },
    take: 500,
  });

  const reviews = rows
    .map((r) => ({ r, steps: r.workflow.steps.map(toStepDef) }))
    .filter(({ r, steps }) => canSeeReview(ctx, r.initiatorId, steps, r.documents.map((d) => d.version.document.folderId)))
    // ⭐ text search across names, files, people and comments
    .filter(({ r }) =>
      matchesSearch(terms, r.number, [
        r.name,
        r.workflow.name,
        r.initiator?.name,
        ...r.documents.map((d) => d.version.document.name),
        ...r.decisions.flatMap((d) => [d.comment, d.reviewer.name]),
      ]),
    );

  const fmt = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeZone: ctx.project.timezone });
  const base = `/projects/${projectId}/reviews`;
  const tabHref = (s: string) => `${base}?${new URLSearchParams({ ...(q ? { q } : {}), ...(s !== "ALL" ? { status: s } : {}) })}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Reviews</h2>
        <Link href={`${base}/new`} className={btn}>Start a review</Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex overflow-hidden rounded-md border border-line text-sm" role="group" aria-label="Status">
          {(["ALL", "OPEN", "CLOSED"] as const).map((s) => (
            <Link key={s} href={tabHref(s)} aria-current={status === s ? "true" : undefined} className={`px-3 py-1 ${status === s ? "bg-brand text-white" : "bg-surface hover:bg-muted"}`}>
              {s === "ALL" ? "All" : s === "OPEN" ? "Open" : "Closed"}
            </Link>
          ))}
        </div>
        <form className="flex w-full gap-2 sm:w-auto" role="search" action={base}>
          {status !== "ALL" && <input type="hidden" name="status" value={status} />}
          <input className={`${input} sm:w-72`} type="search" name="q" defaultValue={q} aria-label="Search reviews" placeholder="Search name, file, person, comment or #number" />
          <button className={btnGhost} type="submit">Search</button>
        </form>
      </div>

      {reviews.length === 0 ? (
        <div className={`${card} p-8 text-center text-sm text-ink-soft`}>
          {terms.length ? "No reviews match your search." : "No reviews yet. Start one to send files for approval."}
        </div>
      ) : (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full" data-testid="reviews-table">
            <thead className="border-b border-line bg-muted/50">
              <tr>
                <th className={`${th} w-16`}>ID</th>
                <th className={th}>Name</th>
                <th className={th}>Status</th>
                <th className={`${th} hidden md:table-cell`}>Workflow</th>
                <th className={`${th} hidden sm:table-cell`}>Files</th>
                <th className={`${th} hidden lg:table-cell`}>Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {reviews.map(({ r, steps }) => {
                const step = steps.find((s) => s.order === r.currentStep);
                const mine = r.status === "OPEN" && !!step && matchesSubject(ctx.member, step.reviewers);
                const statuses = parseStatuses(r.workflow.statuses);
                const outcomes = new Map<Outcome, number>();
                for (const d of r.documents) if (d.outcome) outcomes.set(d.outcome as Outcome, (outcomes.get(d.outcome as Outcome) ?? 0) + 1);
                return (
                  <tr key={r.id} data-testid="review-row">
                    <td className={`${td} whitespace-nowrap text-ink-soft`}>#{r.number}</td>
                    <td className={td}>
                      <Link href={`${base}/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                      {r.autoStarted && <span className="ml-2 text-xs text-ink-soft">auto</span>}
                      <p className="mt-1 text-xs text-ink-soft md:hidden">{r.workflow.name}</p>
                    </td>
                    <td className={td}>
                      {r.status === "OPEN" ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <span className={`${badge} bg-sky-100 text-sky-900`}>Step {r.currentStep} of {steps.length}{step ? ` · ${step.name}` : ""}</span>
                          {mine && <span className={`${badge} bg-accent/20 text-ink`} data-testid="awaiting-me">Awaiting you</span>}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {[...outcomes].map(([o, n]) => (
                            <span key={o} className={`${badge} ${OUTCOME_BADGE[o]}`}>{n} {labelFor(statuses, o)}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className={`${td} hidden md:table-cell`}>{r.workflow.name}</td>
                    <td className={`${td} hidden sm:table-cell`}>{r.documents.length}</td>
                    <td className={`${td} hidden whitespace-nowrap lg:table-cell`}>
                      {fmt.format(r.createdAt)}
                      <span className="block text-xs text-ink-soft">{r.initiator?.name ?? "Former member"}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
