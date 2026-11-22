import { notFound } from "next/navigation";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { input, label } from "@/components/ui";
import { db } from "@/lib/db";
import { acceptInvite } from "@/modules/admin/actions";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await db.user.findUnique({
    where: { inviteToken: token },
    include: { account: true, memberships: { include: { project: true } } },
  });
  if (!user) notFound();
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Join {user.account.name}</h1>
      <p className="mb-6 text-sm text-ink-soft">
        You&apos;ve been invited to {user.memberships.map((m) => m.project.name).join(", ") || "BushBIM"}. Set a password to continue.
      </p>
      <ActionForm action={acceptInvite} className="space-y-4" resetOnSuccess={false}>
        <input type="hidden" name="token" value={token} />
        <div>
          <label className={label}>Email</label>
          <input className={input} value={user.email} disabled readOnly />
        </div>
        <div>
          <label className={label} htmlFor="name">Your name</label>
          <input className={input} id="name" name="name" defaultValue={user.name} required />
        </div>
        <div>
          <label className={label} htmlFor="password">Password</label>
          <input className={input} id="password" name="password" type="password" minLength={8} autoComplete="new-password" required />
        </div>
        <SubmitButton className="w-full rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">Join project</SubmitButton>
      </ActionForm>
    </>
  );
}
