import type { Prisma, PrismaClient } from "@prisma/client";
import { ROOTS } from "./logic";

/** Creates the "Plans" and "Project Files" root folders if missing. Idempotent. */
export async function ensureRootFolders(db: PrismaClient | Prisma.TransactionClient, projectId: string, createdById?: string) {
  await db.folder.createMany({
    data: ROOTS.map((r) => ({ projectId, root: r.root, name: r.name, createdById: createdById ?? null })),
    skipDuplicates: true,
  });
}
