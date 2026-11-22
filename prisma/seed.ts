// Demo data: a luxury lodge build in the Greater Kruger area.
// Login: admin@bushbim.test / bushbim123
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  const email = "admin@bushbim.test";
  if (await db.user.findUnique({ where: { email } })) {
    console.log("Seed already applied.");
    return;
  }
  const account = await db.account.create({ data: { name: "Savanna Resorts Development" } });
  const admin = await db.user.create({
    data: { email, name: "Naledi Dlamini", accountId: account.id, accountRole: "ACCOUNT_ADMIN", passwordHash: await bcrypt.hash("bushbim123", 10) },
  });
  const companies = await Promise.all(
    [
      ["Savanna Resorts Development", "Developer", "South Africa"],
      ["Umhlaba Architects", "Architect", "South Africa"],
      ["Bushveld Builders", "Main contractor", "South Africa"],
      ["Lowveld MEP", "MEP", "South Africa"],
      ["Mopane Thatching Co.", "Thatching", "South Africa"],
    ].map(([name, trade, country]) => db.company.create({ data: { accountId: account.id, name, trade, country } })),
  );
  const roles = await Promise.all(
    ["Development Manager", "Architect", "Site Manager", "Quantity Surveyor", "Subcontractor"].map((name) =>
      db.role.create({ data: { accountId: account.id, name } }),
    ),
  );
  const projects = await Promise.all(
    [
      { name: "Kruger Lodge Villas", code: "KLV", type: "Safari lodge", location: "Sabi Sand", country: "South Africa" },
      { name: "Zanzibar Beach Retreat", code: "ZBR", type: "Beach resort", location: "Matemwe", country: "Tanzania", currency: "USD", timezone: "Africa/Dar_es_Salaam" },
    ].map((p) => db.project.create({ data: { accountId: account.id, ...p } })),
  );
  const people = [
    { email: "sipho@umhlaba.test", name: "Sipho Khumalo", company: 1, role: 1, services: ["DOCS", "ISSUES"] },
    { email: "anika@bushveld.test", name: "Anika van Wyk", company: 2, role: 2, services: ["DOCS", "ISSUES", "CHECKLISTS", "DAILY_LOGS"] },
    { email: "tumi@lowveld.test", name: "Tumi Mahlangu", company: 3, role: 4, services: ["DOCS", "ISSUES", "CHECKLISTS"] },
  ] as const;
  const klv = projects[0];
  await db.projectMember.create({
    data: { projectId: klv.id, userId: admin.id, accessLevel: "PROJECT_ADMIN", status: "ACTIVE", companyId: companies[0].id, services: ["DOCS", "ISSUES", "CHECKLISTS", "DAILY_LOGS"], roles: { create: { roleId: roles[0].id } } },
  });
  for (const p of people) {
    const u = await db.user.create({ data: { email: p.email, name: p.name, accountId: account.id, passwordHash: await bcrypt.hash("bushbim123", 10) } });
    await db.projectMember.create({
      data: { projectId: klv.id, userId: u.id, status: "ACTIVE", companyId: companies[p.company].id, services: [...p.services], roles: { create: { roleId: roles[p.role].id } } },
    });
  }
  await db.servicePermission.createMany({
    data: [
      { projectId: klv.id, service: "DOCS", subjectType: "COMPANY", subjectId: companies[1].id, level: "MANAGER" },
      { projectId: klv.id, service: "ISSUES", subjectType: "ROLE", subjectId: roles[2].id, level: "MANAGER" },
      { projectId: klv.id, service: "ISSUES", subjectType: "ROLE", subjectId: roles[4].id, level: "CREATOR" },
    ],
  });
  console.log("Seeded. Sign in as admin@bushbim.test / bushbim123");
}

main().finally(() => db.$disconnect());
