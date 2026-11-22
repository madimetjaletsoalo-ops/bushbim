// Pure helpers for project display. No database access so they can be unit-tested.

/** Short label for a project without a cover photo: its code, else the initials of its first two words. */
export function projectInitials(name: string, code?: string | null): string {
  const c = code?.trim();
  if (c) return c.slice(0, 6).toUpperCase();
  const words = name.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const letters = words.slice(0, 2).map((w) => [...w.replace(/^[^\p{L}\p{N}]+/u, "")][0] ?? "");
  return letters.join("").toUpperCase() || "?";
}
