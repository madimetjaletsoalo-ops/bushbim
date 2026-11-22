import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { input, label } from "@/components/ui";
import { signIn } from "@/modules/admin/actions";

export default function LoginPage() {
  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">Sign in</h1>
      <ActionForm action={signIn} className="space-y-4" resetOnSuccess={false}>
        <div>
          <label className={label} htmlFor="email">Email</label>
          <input className={input} id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <label className={label} htmlFor="password">Password</label>
          <input className={input} id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <SubmitButton className="w-full rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">Sign in</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-sm text-ink-soft">
        New organisation? <Link className="font-medium text-brand hover:underline" href="/signup">Create an account</Link>
      </p>
    </>
  );
}
