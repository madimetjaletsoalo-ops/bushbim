"use client";

import { useParams, useRouter } from "next/navigation";

export function ProjectSwitcher({ projects }: { projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const params = useParams<{ projectId?: string }>();
  return (
    <select
      aria-label="Switch project"
      className="max-w-[55vw] truncate rounded-md border border-white/15 bg-white/5 px-2 py-1 text-sm text-chrome-ink sm:max-w-xs"
      value={params.projectId ?? ""}
      onChange={(e) => router.push(e.target.value ? `/projects/${e.target.value}` : "/projects")}
    >
      <option value="" className="text-black">All projects</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id} className="text-black">
          {p.name}
        </option>
      ))}
    </select>
  );
}
