import type { ReactNode } from "react";
import { Logo } from "./ui/Logo";
import { versionLabel } from "../version";

// The card the sign-in screen and the setup wizard sit in: the logo above a charcoal card on the dark page
export default function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-page px-4 pt-10 pb-14">
      <div className="mb-6 flex flex-col items-center gap-3">
        <Logo className="size-20 rounded-3xl" />
        <p className="text-3xl font-bold leading-none tracking-tight">
          Byte<span className="text-brand">Size</span>
        </p>
      </div>
      <div className="w-full max-w-sm rounded-2xl bg-container p-6 sm:p-8">{children}</div>
      <p className="absolute inset-x-0 bottom-4 text-center text-xs text-muted">ByteSize {versionLabel}</p>
    </div>
  );
}
