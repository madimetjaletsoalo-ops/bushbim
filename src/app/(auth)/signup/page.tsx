import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { input, label } from "@/components/ui";
import { signUp } from "@/modules/admin/actions";

export default function SignUpPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Create your organisation</h1>
      <p className="mb-6 text-sm text-ink-soft">You&apos;ll be the account admin and can invite your team after.</p>
      <ActionForm action={signUp} className="space-y-4" resetOnSuccess={false}>
        <div>
          <label className={label} htmlFor="organisation">Organisation</label>
          <input className={input} id="organisation" name="organisation" placeholder="e.g. Savanna Resorts Development" required />
        </div>
        <div>
          <label className={label} htmlFor="name">Your name</label>
          <input className={input} id="name" name="name" autoComplete="name" required />
        </div>
        <div>
          <label className={label} htmlFor="email">Work email</label>
          <input className={input} id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <label className={label} htmlFor="password">Password</label>
          <input className={input} id="password" name="password" type="password" minLength={8} autoComplete="new-password" required />
        </div>
        <SubmitButton className="w-full rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">Create account</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-sm text-ink-soft">
        Already have an account? <Link className="font-medium text-brand hover:underline" href="/login">Sign in</Link>
      </p>
    </>
  );
}
