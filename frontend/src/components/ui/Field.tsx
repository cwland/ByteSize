import type { InputHTMLAttributes } from "react";
import { field, label as labelClass, noAutofill } from "./styles";

// A labelled text box. Password managers are told to leave it alone (noAutofill), except for a password
// box (signing in, setting a password) and the other sign-in fields, marked signIn (username, the reset
// email and code): those keep their own autoComplete for the password manager.
export function Field({ label, signIn = false, ...props }: { label: string; signIn?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  const forPasswordManager = signIn || props.type === "password";
  return (
    <label className={`${labelClass} mt-3 first:mt-0`}>
      {label}
      <input aria-label={label} {...(forPasswordManager ? {} : noAutofill)} {...props} className={field} />
    </label>
  );
}
