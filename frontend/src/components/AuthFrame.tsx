import type { ReactNode } from "react";
import { Logo } from "./ui/Logo";
import { versionLabel } from "../version";

// The card the sign-in screen and the setup wizard sit in
export default function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-page px-4 pb-10">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-container p-8">
        <div className="mb-6 flex items-center gap-3">
          <Logo className="size-12" />
          <p className="text-3xl font-bold leading-none tracking-tight">ByteSize</p>
        </div>
        {children}
      </div>
      <p className="absolute inset-x-0 bottom-4 text-center text-xs text-muted">ByteSize {versionLabel}</p>
    </div>
  );
}
