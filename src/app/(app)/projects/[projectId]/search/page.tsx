import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { badge, btn, btnGhost, card, input, label } from "@/components/ui";
import { can } from "@/lib/permissions";
import { getDocsContext } from "@/modules/docs/access";
import { issueLabel } from "@/modules/issues/logic";
import { transmittalLabel } from "@/modules/transmittals/logic";
import { runProjectIndex } from "@/modules/search/actions";
import { KINDS, KIND_LABELS, METHOD_LABELS, hasCriteria, parseSearch, splitHighlight, type Kind } from "@/modules/search/logic";
import { SearchError, indexStatus, searchDocuments, searchIssues, searchReviews, searchTransmittals } from "@/modules/search/server";

export const metadata = { title: "Search" };

function Snippet({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className="mt-1 text-sm break-words text-ink-soft" data-testid="snippet">
      {splitHighlight(text).map((s, i) => (s.hit ? <mark key={i} className="rounded-sm bg-amber-200 px-0.5 text-ink">{s.text}</mark> : <span key={i}>{s.text}</span>))}
    </p>
  );
}

function Section({ title, kind, count, more, children }: { title: string; kind: Kind; count: number; more?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} data-testid={`results-${kind}`} className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold">
          {title} <span className="text-sm font-normal text-ink-soft">({count})</span>
        </h3>
        {more && <Link href={more} className="text-sm text-brand hover:underline">Show all</Link>}
      </div>
      {count === 0 ? <p className="text-sm text-ink-soft">No matches.</p> : <ul className={`${card} divide-y divide-line`}>{children}</ul>}
    </section>
  );
}

const STATUS_NOTE: Record<string, string> = { PENDING: "Indexing…", PROCESSING: "Indexing…", FAILED: "Couldn't read", SKIPPED: "Name only" };

export default async function SearchPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { projectId } = await params;
  const ctx = await getDocsContext(projectId);
  const docs = can(ctx.member, "DOCS", "view", ctx.grants);
  const issues = can(ctx.member, "ISSUES", "view", ctx.grants);
  if (!docs && !issues) notFound();
  const r = parseSearch(await searchParams);
  const base = `/projects/${projectId}`;
  const all = r.kind === "all";
  const limit = all ? 10 : 100;
  const wants = (k: Kind) => all || r.kind === k;

  let error = r.error;
  let results: Awaited<ReturnType<typeof run>> | null = null;
  async function run() {
    const [d, i, rv, t] = await Promise.all([
      wants("documents") ? searchDocuments(ctx, r, limit) : null,
      wants("issues") ? searchIssues(ctx, r, limit) : null,
      wants("reviews") ? searchReviews(ctx, r, limit) : null,
      wants("transmittals") ? searchTransmittals(ctx, r, limit) : null,
    ]);
    return { d, i, rv, t };
  }
  if (hasCriteria(r)) {
    try {
      results = await run();
    } catch (e) {
      if (!(e instanceof SearchError)) throw e;
      error = e.message;
    }
  }
  const status = ctx.isAdmin && docs ? await indexStatus(projectId) : null;

  const moreHref = (k: Kind) => {
    const sp = new URLSearchParams({ ...(r.q ? { q: r.q } : {}), kind: k, ...(r.name ? { mode: r.mode, name: r.name } : {}), ...(r.invert ? { invert: "1" } : {}) });
    return `${base}/search?${sp}`;
  };
  const more = (k: Kind, n: number) => (all && n >= limit ? moreHref(k) : undefined);
  const fmtTotal = results ? [results.d, results.i, results.rv, results.t].reduce((n, x) => n + (x?.length ?? 0), 0) : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-4 sm:px-6 md:py-6">
      <h2 className="text-xl font-semibold">Search</h2>

      <form role="search" action={`${base}/search`} className={`${card} space-y-3 p-4`} data-testid="search-form">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className={input}
            type="search"
            name="q"
            defaultValue={r.q}
            maxLength={300}
            aria-label="Search for"
            placeholder={'Words in files, issues, reviews, transmittals — "exact phrase", OR, -exclude, #12'}
          />
          <select name="kind" defaultValue={r.kind} aria-label="Search in" className={`${input} sm:w-44`}>
            {KINDS.filter((k) => k === "all" || (k === "issues" ? issues : docs)).map((k) => (
              <option key={k} value={k}>{KIND_LABELS[k]}</option>
            ))}
          </select>
          <button className={btn} type="submit">Search</button>
        </div>
        <details open={!!r.name} className="text-sm">
          <summary className="cursor-pointer font-medium text-ink">Filter by name pattern</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr]">
            <fieldset className="flex gap-4 sm:flex-col sm:gap-1">
              <legend className="sr-only">Pattern type</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="mode" value="pattern" defaultChecked={r.mode === "pattern"} /> Naming pattern
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="mode" value="regex" defaultChecked={r.mode === "regex"} /> Regular expression
              </label>
            </fieldset>
            <div>
              <label className={label} htmlFor="name-pattern">Name pattern</label>
              <input id="name-pattern" className={`${input} font-mono`} name="name" defaultValue={r.name} maxLength={200} placeholder="KLV-ARC-### or ^KLV-(ARC|STR)-\d{3}" />
              <p className="mt-1 text-xs text-ink-soft">
                Naming pattern: <code>#</code> a digit, <code>@</code> a letter, <code>?</code> any character, <code>*</code> anything; the file extension is optional.
                Applies to file names, issue titles, review names and transmittal subjects. Leave the search box empty to list every name that matches.
              </p>
              <label className="mt-2 flex items-center gap-2">
                <input type="checkbox" name="invert" value="1" defaultChecked={r.invert} /> Show names that <strong>don&apos;t</strong> match (find files off the naming convention)
              </label>
            </div>
          </div>
        </details>
      </form>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}

      {!results && !error && (
        <div className={`${card} p-6 text-sm text-ink-soft`}>
          Search the text inside PDFs (scanned drawings are read with OCR), Word and Excel files, plus issues, reviews and transmittals.
          Words match their beginnings and word forms, so <em>waterproof</em> finds <em>waterproofing</em>.
        </div>
      )}

      {results && (
        <div className="space-y-6" data-testid="search-results">
          <p className="text-sm text-ink-soft" role="status">{fmtTotal === 0 ? "Nothing matches your search." : `${fmtTotal} result${fmtTotal === 1 ? "" : "s"}`}</p>

          {results.d && (
            <Section title="Documents" kind="documents" count={results.d.length} more={more("documents", results.d.length)}>
              {results.d.map((h) => (
                <li key={h.id} className="p-3" data-testid="hit">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <Link href={h.viewable ? `${base}/viewer/${h.versionId}` : `${base}/docs/folders/${h.folderId}`} className="font-medium break-all hover:underline">{h.name}</Link>
                    <span className="text-xs text-ink-soft">V{h.version} · {h.folderName}</span>
                    {h.status && h.status !== "DONE" ? (
                      <span className={`${badge} bg-muted text-ink-soft`}>{STATUS_NOTE[h.status] ?? h.status}</span>
                    ) : h.method && h.method !== "NONE" ? (
                      <span className={`${badge} bg-emerald-50 text-emerald-800`}>{METHOD_LABELS[h.method]}</span>
                    ) : null}
                  </div>
                  <Snippet text={h.snippet} />
                </li>
              ))}
            </Section>
          )}
          {results.i && (
            <Section title="Issues" kind="issues" count={results.i.length} more={more("issues", results.i.length)}>
              {results.i.map((h) => (
                <li key={h.id} className="flex gap-3 p-3" data-testid="hit">
                  <span className="w-1 shrink-0 rounded-full" style={{ backgroundColor: h.status.color }} aria-hidden />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm text-ink-soft">{issueLabel(h.number)}</span>
                      <Link href={`${base}/issues/${h.id}`} className="font-medium break-words hover:underline">{h.title}</Link>
                      <span className="text-xs text-ink-soft">{[h.type, h.status.name].filter(Boolean).join(" · ")}</span>
                    </div>
                    <Snippet text={h.snippet} />
                  </div>
                </li>
              ))}
            </Section>
          )}
          {results.rv && (
            <Section title="Reviews" kind="reviews" count={results.rv.length} more={more("reviews", results.rv.length)}>
              {results.rv.map((h) => (
                <li key={h.id} className="p-3" data-testid="hit">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm text-ink-soft">#{h.number}</span>
                    <Link href={`${base}/reviews/${h.id}`} className="font-medium break-words hover:underline">{h.name}</Link>
                    <span className="text-xs text-ink-soft">{h.status === "OPEN" ? "Open" : "Closed"}</span>
                  </div>
                  <Snippet text={h.snippet} />
                </li>
              ))}
            </Section>
          )}
          {results.t && (
            <Section title="Transmittals" kind="transmittals" count={results.t.length} more={more("transmittals", results.t.length)}>
              {results.t.map((h) => (
                <li key={h.id} className="p-3" data-testid="hit">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm text-ink-soft">{transmittalLabel(h.number)}</span>
                    <Link href={`${base}/transmittals/${h.id}`} className="font-medium break-words hover:underline">{h.subject}</Link>
                  </div>
                  <Snippet text={h.snippet} />
                </li>
              ))}
            </Section>
          )}
        </div>
      )}

      {status && (
        <section className={`${card} space-y-3 p-4`} aria-label="Search index" data-testid="index-status">
          <h3 className="text-base font-semibold">Search index</h3>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            {([["DONE", "Indexed"], ["PENDING", "Queued"], ["PROCESSING", "Indexing"], ["SKIPPED", "Name only"], ["FAILED", "Failed"]] as const).map(([k, l]) => (
              <div key={k} className="rounded-md bg-muted/60 px-3 py-2">
                <dt className="text-xs text-ink-soft">{l}</dt>
                <dd className="text-lg font-semibold" data-testid={`index-${k.toLowerCase()}`}>{status.counts[k]}</dd>
              </div>
            ))}
          </dl>
          {status.problems.length > 0 && (
            <ul className="space-y-1 text-sm">
              {status.problems.map((p) => (
                <li key={p.id} className="break-words">
                  <span className="font-medium">{p.version.fileName}</span> <span className="text-ink-soft">V{p.version.number}: {p.status === "FAILED" ? "failed — " : ""}{p.error}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <ActionForm action={runProjectIndex.bind(null, projectId)} resetOnSuccess={false} testId="index-pending">
              <input type="hidden" name="scope" value="pending" />
              <SubmitButton className={btnGhost}>Index queued files now</SubmitButton>
            </ActionForm>
            <ActionForm action={runProjectIndex.bind(null, projectId)} resetOnSuccess={false} testId="index-all">
              <input type="hidden" name="scope" value="all" />
              <SubmitButton className={btnGhost}>Re-index all files</SubmitButton>
            </ActionForm>
          </div>
          <p className="text-xs text-ink-soft">New uploads are indexed in the background within a minute or so; a nightly run catches anything left over.</p>
        </section>
      )}
    </div>
  );
}
