export function Logo({ className = "" }: { className?: string }) {
  // Simple acacia-tree mark; original artwork.
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="var(--accent)" />
        <path d="M5 13c3-4 19-4 22 0-4 1.5-18 1.5-22 0Z" fill="var(--chrome)" />
        <path d="M15 14h2v11h-2z" fill="var(--chrome)" />
        <path d="M16 18l-4-4M16 17l4-3" stroke="var(--chrome)" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span>
        Bush<span className="text-accent">BIM</span>
      </span>
    </span>
  );
}
