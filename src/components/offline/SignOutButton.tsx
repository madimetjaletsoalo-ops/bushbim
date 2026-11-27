"use client";

import { listEntries, offlineUser } from "./outbox";
import { clearOfflineCache } from "./ServiceWorker";

/** Sign out, removing this account's cached pages and files from the device first. */
export function SignOutButton({ action }: { action: () => Promise<void> }) {
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    if (form.dataset.cleared) return; // second pass: let the sign-out action run
    e.preventDefault();
    void (async () => {
      const user = offlineUser();
      const waiting = (await listEntries()).filter((x) => x.userId === user && x.state === "pending").length;
      if (waiting && !window.confirm(`${waiting} offline change${waiting === 1 ? " hasn't" : "s haven't"} synced yet. They stay on this device and sync when you sign in again. Sign out?`)) return;
      await clearOfflineCache();
      form.dataset.cleared = "1";
      form.requestSubmit();
    })();
  }
  return (
    <form action={action} onSubmit={onSubmit} data-testid="sign-out-form">
      <button className="rounded-md border border-white/15 px-2 py-1 text-xs hover:bg-white/10">Sign out</button>
    </form>
  );
}
