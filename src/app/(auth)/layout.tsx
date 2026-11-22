import { Logo } from "@/components/Logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center text-2xl text-ink">
          <Logo />
        </div>
        <div className="rounded-lg border border-line bg-surface p-6 shadow-sm sm:p-8">{children}</div>
        <p className="mt-6 text-center text-xs text-ink-soft">Document control and field management for resort builds across Africa.</p>
      </div>
    </main>
  );
}
