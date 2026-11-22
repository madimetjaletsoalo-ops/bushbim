"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ActionState } from "@/modules/admin/types";

type Props = {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  /** data-testid for e2e tests */
  testId?: string;
};

/** A form bound to a server action that shows the result message inline. */
export function ActionForm({ action, children, className, resetOnSuccess = true, testId }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className} data-testid={testId} aria-busy={pending}>
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {state?.error && (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      )}
      {state?.ok && state.message && (
        <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.message}
        </p>
      )}
      {!!state?.details?.length && (
        <ul className="mt-2 list-disc pl-5 text-xs text-ink-soft">
          {state.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </form>
  );
}
