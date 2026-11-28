"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import type { ActionState } from "@/modules/admin/types";
import { isNetworkError } from "@/modules/offline/logic";
import { OfflinePhotoPicker } from "./offline/OfflinePhotoPicker";
import { OFFLINE_SAVED, queueForm, type OfflineIntent } from "./offline/queue";

type Props = {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  /** data-testid for e2e tests */
  testId?: string;
  /** lets inputs elsewhere on the page join this form via their `form` attribute */
  id?: string;
  /** with no connection, keep the submission on this device and sync it later */
  offline?: OfflineIntent;
};

/** A form bound to a server action that shows the result message inline. */
export function ActionForm({ action, children, className, resetOnSuccess = true, testId, id, offline }: Props) {
  // the offline issue just saved on this device, so photos can be added to it
  const [queuedIssue, setQueuedIssue] = useState<string | null>(null);
  const run = useCallback(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      if (!offline) return action(prev, form);
      const save = async (): Promise<ActionState> => {
        const clientId = await queueForm(offline, form).catch(() => null);
        if (!clientId) return { ok: false, error: "You're offline and this change couldn't be kept on this device. Try again when you're connected." };
        if (offline.kind === "issue.create") {
          setQueuedIssue(clientId);
          ref.current?.reset();
        }
        return { ok: true, message: OFFLINE_SAVED, details: [] };
      };
      if (typeof navigator !== "undefined" && !navigator.onLine) return save();
      try {
        return await action(prev, form);
      } catch (e) {
        if (isNetworkError(e)) return save();
        throw e;
      }
    },
    [action, offline],
  );
  const [state, formAction, pending] = useActionState(run, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} id={id} action={formAction} className={className} data-testid={testId} aria-busy={pending}>
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
      {state?.ok && state.message === OFFLINE_SAVED && queuedIssue && offline?.kind === "issue.create" && (
        <OfflinePhotoPicker projectId={offline.projectId} target={{ type: "offline-issue", issueClientId: queuedIssue }} />
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
