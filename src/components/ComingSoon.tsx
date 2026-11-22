import { card } from "./ui";

export function ComingSoon({ title, items }: { title: string; items: string[] }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className={`${card} p-6`}>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-ink-soft">This module is on the build backlog. Coming next:</p>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </div>
    </main>
  );
}
