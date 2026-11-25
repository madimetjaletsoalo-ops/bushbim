import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { IssueFields } from "@/components/issues/IssueFields";
import { SubmitButton } from "@/components/SubmitButton";
import { card } from "@/components/ui";
import { createIssue } from "@/modules/issues/actions";
import { getIssuesContext } from "@/modules/issues/server";

export default async function NewIssuePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await getIssuesContext(projectId);
  if (!ctx.canCreate)
    return (
      <div className={`${card} p-6 text-sm text-ink-soft`} data-testid="cannot-create">
        Creating issues needs Issues Creator access. Ask a project admin.
      </div>
    );
  return (
    <div className="space-y-4">
      <Link href={`/projects/${projectId}/issues`} className="text-sm text-ink-soft hover:underline">← Issues</Link>
      <h2 className="text-xl font-semibold">New issue</h2>
      <section className={`${card} p-5`}>
        <ActionForm action={createIssue.bind(null, projectId)} resetOnSuccess={false} testId="issue-form" className="space-y-4">
          <IssueFields ctx={ctx} idPrefix="new" withStatus defaults={{ watcherIds: [ctx.user.id] }} />
          <SubmitButton>Create issue</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
