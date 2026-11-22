import { card, td, th } from "@/components/ui";
import { db } from "@/lib/db";
import { requireProjectAdmin } from "@/lib/auth";

export default async function ActivityPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { project } = await requireProjectAdmin(projectId);
  const events = await db.auditEvent.findMany({
    where: { projectId },
    include: { actor: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const fmt = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: project.timezone });
  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Activity</h2>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[560px]">
          <thead className="border-b border-line bg-muted/50"><tr><th className={th}>When</th><th className={th}>Who</th><th className={th}>What</th><th className={th}>Details</th></tr></thead>
          <tbody className="divide-y divide-line">
            {events.length === 0 && <tr><td className={`${td} text-ink-soft`} colSpan={4}>No activity yet.</td></tr>}
            {events.map((e) => (
              <tr key={e.id}>
                <td className={`${td} whitespace-nowrap`}>{fmt.format(e.createdAt)}</td>
                <td className={td}>{e.actor.name}</td>
                <td className={`${td} font-mono text-xs`}>{e.action}</td>
                <td className={`${td} text-xs text-ink-soft`}>{e.details ? JSON.stringify(e.details) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
