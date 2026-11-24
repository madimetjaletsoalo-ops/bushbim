import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { IssueFields } from "@/components/issues/IssueFields";
import { SubmitButton } from "@/components/SubmitButton";
import { card } from "@/components/ui";
import { createIssue } from "@/modules/issues/actions";
import { getIssuesContext } from "@/modules/issues/server";
import { readPinFields } from "@/modules/issues/media";
import { pinTarget } from "@/modules/issues/media-server";
import { db } from "@/lib/db";

type PinParams = { pinVersionId?: string; pinPage?: string; pinX?: string; pinY?: string };

export default async function NewIssuePage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<PinParams> }) {
  const { projectId } = await params;
  const sp = await searchParams;
  const ctx = await getIssuesContext(projectId);
  if (!ctx.canCreate)
    return (
      <div className={`${card} p-6 text-sm text-ink-soft`} data-testid="cannot-create">
        Creating issues needs Issues Creator access. Ask a project admin.
      </div>
    );
  // "New issue here" from the viewer: the issue is pinned where the user clicked
  const read = readPinFields((k) => sp[k as keyof PinParams] ?? "");
  const pin = read && !("error" in read) ? read : null;
  const target = pin ? await pinTarget(projectId, pin.versionId) : null;
  const sheet = pin && target ? await db.sheet.findUnique({ where: { versionId_page: { versionId: pin.versionId, page: pin.page } } }) : null;
  return (
    <div className="space-y-4">
      <Link href={`/projects/${projectId}/issues`} className="text-sm text-ink-soft hover:underline">← Issues</Link>
      <h2 className="text-xl font-semibold">New issue</h2>
      <section className={`${card} p-5`}>
        <ActionForm action={createIssue.bind(null, projectId)} resetOnSuccess={false} testId="issue-form" className="space-y-4">
          {pin && target && (
            <div className="rounded-md border border-brand/30 bg-brand/5 px-3 py-2 text-sm" data-testid="pin-note">
              Will be pinned on {sheet ? `${sheet.number} ${sheet.title}` : target.document.name}, page {pin.page}.
              <input type="hidden" name="pinVersionId" value={pin.versionId} />
              <input type="hidden" name="pinPage" value={pin.page} />
              <input type="hidden" name="pinX" value={pin.x} />
              <input type="hidden" name="pinY" value={pin.y} />
            </div>
          )}
          <IssueFields ctx={ctx} idPrefix="new" withStatus defaults={{ watcherIds: [ctx.user.id] }} />
          <SubmitButton>Create issue</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
