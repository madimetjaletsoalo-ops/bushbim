"use client";

import { useFormStatus } from "react-dom";
import { btn } from "./ui";

export function SubmitButton({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className ?? btn} disabled={pending}>
      {pending ? "Saving…" : children}
    </button>
  );
}
