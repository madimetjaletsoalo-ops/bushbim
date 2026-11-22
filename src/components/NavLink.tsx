"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children, variant = "tab", exact = false }: { href: string; children: React.ReactNode; variant?: "tab" | "side"; exact?: boolean }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname.startsWith(href);
  if (variant === "side")
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`block whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${active ? "bg-brand/10 text-brand" : "text-ink-soft hover:bg-muted hover:text-ink"}`}
      >
        {children}
      </Link>
    );
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`whitespace-nowrap border-b-[3px] px-3 py-3 text-sm font-semibold uppercase tracking-wide ${active ? "border-accent text-white" : "border-transparent text-chrome-ink/70 hover:text-white"}`}
    >
      {children}
    </Link>
  );
}
