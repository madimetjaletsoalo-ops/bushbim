// Parses the bulk-invite CSV: email,name,company,role,accessLevel
// Header row optional. Returns valid rows plus per-line errors, and flags
// duplicate emails within the file (a common complaint about bulk imports).

export interface InviteRow {
  line: number;
  email: string;
  name: string;
  company?: string;
  role?: string;
  accessLevel: "PROJECT_ADMIN" | "MEMBER";
}

export interface ParseResult {
  rows: InviteRow[];
  errors: { line: number; message: string }[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseInviteCsv(text: string): ParseResult {
  const rows: InviteRow[] = [];
  const errors: ParseResult["errors"] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = idx + 1;
    if (!raw.trim()) return;
    const [emailRaw = "", name = "", company = "", role = "", access = ""] = splitLine(raw);
    const email = emailRaw.toLowerCase();
    if (idx === 0 && email === "email") return; // header
    if (!EMAIL_RE.test(email)) return void errors.push({ line, message: `Invalid email "${emailRaw}"` });
    if (seen.has(email)) return void errors.push({ line, message: `Duplicate email ${email} in file` });
    seen.add(email);
    const a = access.toUpperCase().replace(/\s+/g, "_");
    if (a && a !== "PROJECT_ADMIN" && a !== "MEMBER" && a !== "ADMIN")
      return void errors.push({ line, message: `Unknown access level "${access}"` });
    rows.push({
      line,
      email,
      name: name || email.split("@")[0],
      company: company || undefined,
      role: role || undefined,
      accessLevel: a === "PROJECT_ADMIN" || a === "ADMIN" ? "PROJECT_ADMIN" : "MEMBER",
    });
  });
  return { rows, errors };
}
