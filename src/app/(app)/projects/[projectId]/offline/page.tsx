import { OfflineChanges } from "@/components/offline/OfflineChanges";
import { card, td, th } from "@/components/ui";
import { db } from "@/lib/db";
import { getProjectContext } from "@/lib/auth";

const KIND: Record<string, string> = { "issue.create": "New issue", "checklist.answer": "Checklist answer", photo: "Photo" };

/** Offline changes: what this device still has to sync, conflicts to resolve, and what synced recently. */
export default async function OfflinePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { user, project } = await getProjectContext(projectId);
  const synced = await db.offlineChange.findMany({ where: { projectId, userId: user.id }, orderBy: { updatedAt: "desc" }, take: 20 });
  const fmt = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: project.timezone });
  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6 sm:px-6">
      <div>
        <h2 className="text-xl font-semibold">Offline changes</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Issues, checklist answers and photos you make without a connection are kept on this device and sync on their own when you&apos;re back online.
          If someone else changed the same thing in the meantime, you choose which version to keep.
        </p>
      </div>
      <OfflineChanges projectId={projectId} userId={user.id} />
      <section className={card}>
        <h3 className="border-b border-line px-4 py-3 font-semibold">Synced recently</h3>
        {synced.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-soft">Nothing synced from offline yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem]" data-testid="offline-synced">
              <thead className="bg-muted">
                <tr><th className={th}>Change</th><th className={th}>Made</th><th className={th}>Result</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {synced.map((s) => (
                  <tr key={s.id}>
                    <td className={td}>{KIND[s.kind] ?? s.kind}</td>
                    <td className={`${td} whitespace-nowrap`}>{fmt.format(s.madeAt)}</td>
                    <td className={td}>
                      {s.result === "APPLIED" ? "Saved" : "Conflict"}
                      {s.message && <p className="text-xs text-ink-soft">{s.message}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
