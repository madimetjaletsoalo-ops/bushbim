// Shared Tailwind class strings. Kept as plain strings so server and client
// components can both use them without a component library.
export const btn =
  "inline-flex items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
export const btnGhost =
  "inline-flex items-center justify-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-muted disabled:opacity-50";
export const btnDanger =
  "inline-flex items-center justify-center rounded-md px-2 py-1 text-sm font-medium text-red-700 hover:bg-red-50";
export const input =
  "block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-soft focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30";
export const label = "block text-sm font-medium text-ink mb-1";
export const card = "rounded-lg border border-line bg-surface shadow-sm";
export const th = "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-soft";
export const td = "px-4 py-3 text-sm text-ink align-top";
export const badge = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";
