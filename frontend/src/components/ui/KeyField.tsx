import { useEffect, useRef, useState } from "react";
import { Copy, Eye, EyeOff } from "lucide-react";
import { field, label as labelClass } from "./styles";

export const COPY_FAILED = "Couldn't copy. Show the key and copy it by hand.";

/**
 * Puts text on the clipboard. The clipboard API first; when it's missing or refused (plain http on a
 * home-network address), a temporary off-screen text box and execCommand("copy"). False when neither works.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // refused: try the old way
  }
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.setAttribute("aria-hidden", "true");
  box.style.position = "fixed";
  box.style.top = "0";
  box.style.left = "-9999px";
  document.body.appendChild(box);
  const was = document.activeElement as HTMLElement | null;
  try {
    box.focus();
    box.select();
    return document.execCommand?.("copy") ?? false;
  } catch {
    return false;
  } finally {
    box.remove();
    was?.focus?.();
  }
}

/**
 * A key or secret box with an eye (show / hide) and a copy button at its end.
 * - Eye: shows what is typed; with nothing typed and a key saved, fetches the saved key and shows it.
 *   Again hides it (a shown saved key is dropped, back to the "saved" placeholder).
 * - Copy: what is typed, or else the saved key (fetched, never displayed). The button reads "Copied" for 2 s.
 * A shown saved key lives only in this component: it is not the typed value (so it is never saved as a new
 * key) until it's edited, and it is gone when the field goes away.
 * keyName names the buttons ("Show USDA key", "Copy USDA key") so several fields on a page stay apart.
 */
export function KeyField({
  label,
  keyName,
  value,
  onChange,
  saved,
  fetchSaved,
  placeholder,
  id,
  showLabel = true,
  autoComplete = "off",
  inputClassName = "",
}: {
  label: string;
  keyName: string;
  value: string;
  onChange: (v: string) => void;
  saved: boolean;
  fetchSaved: () => Promise<string>;
  placeholder?: string;
  id?: string;
  showLabel?: boolean;
  autoComplete?: string;
  inputClassName?: string;
}) {
  const [shown, setShown] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null); // the saved key, while it's shown
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  // Saved, replaced or removed: a shown saved key is out of date
  useEffect(() => {
    setRevealed(null);
    if (!value) setShown(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const typed = value !== "";
  const canUse = typed || saved;

  const toggle = async () => {
    setProblem(null);
    if (shown) {
      setShown(false);
      setRevealed(null);
      return;
    }
    if (typed || !saved) return setShown(true);
    setBusy(true);
    try {
      setRevealed(await fetchSaved());
      setShown(true);
    } catch (e) {
      setProblem((e as Error).message || "Couldn't fetch the key");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    setProblem(null);
    setCopied(false);
    setBusy(true);
    try {
      const text = typed ? value : (revealed ?? (await fetchSaved()));
      if (!(await copyText(text))) return setProblem(COPY_FAILED);
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setProblem((e as Error).message || COPY_FAILED);
    } finally {
      setBusy(false);
    }
  };

  const button = "flex min-w-10 items-center justify-center text-subtle hover:text-ink disabled:opacity-40";
  const box = (
    <div className={`relative ${showLabel ? "mt-1" : ""}`}>
      <input
        id={id}
        aria-label={label}
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        spellCheck={false}
        value={typed ? value : (revealed ?? "")}
        placeholder={placeholder}
        onChange={(e) => {
          setRevealed(null); // edited: what's in the box is now a new key
          onChange(e.target.value);
        }}
        className={`${field} mt-0 min-w-0 font-mono placeholder:font-sans ${copied ? "pr-28" : "pr-21"} ${inputClassName}`}
      />
      <div className="absolute inset-y-0 right-0 flex">
        <button type="button" aria-label={`${shown ? "Hide" : "Show"} ${keyName}`} title={shown ? "Hide" : "Show"} aria-pressed={shown} disabled={busy || !canUse} onClick={() => void toggle()} className={button}>
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
        <button type="button" aria-label={`Copy ${keyName}`} title="Copy" disabled={busy || !canUse} onClick={() => void copy()} className={`${button} min-w-10 rounded-r-xl px-2`}>
          {copied ? <span className="text-xs font-semibold text-success">Copied</span> : <Copy className="size-4" />}
        </button>
      </div>
    </div>
  );
  return (
    <div className="min-w-0">
      {showLabel ? (
        <label className={labelClass}>
          {label}
          {box}
        </label>
      ) : (
        box
      )}
      {copied && (
        <span role="status" className="sr-only">
          {keyName} copied
        </span>
      )}
      {problem && (
        <p role="alert" className="mt-1 text-xs text-error">
          {problem}
        </p>
      )}
    </div>
  );
}
