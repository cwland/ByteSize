import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

// §44: a button or link that shows only an icon. `label` is required and is both the accessible name (aria-label,
// what a screen reader says) and the hover text (title, what a mouse or a long-press shows), so the two can't drift
// apart or be forgotten. A verb phrase with its object: "Delete Banana", "Move to another meal", "Close".
export function IconButton({ label, children, ...props }: { label: string; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title" | "children">) {
  return (
    <button type="button" {...props} aria-label={label} title={label}>
      {children}
    </button>
  );
}

export function IconLink({ label, children, ...props }: { label: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "aria-label" | "title" | "children">) {
  return (
    <a {...props} aria-label={label} title={label}>
      {children}
    </a>
  );
}
