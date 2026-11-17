import type { InputHTMLAttributes } from "react";
import { field, label as labelClass } from "./styles";

// A labelled text box
export function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`${labelClass} mt-3 first:mt-0`}>
      {label}
      <input aria-label={label} {...props} className={field} />
    </label>
  );
}
