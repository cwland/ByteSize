import { useEffect, useId, useRef, useState } from "react";
import { Copy, Eye, EyeOff } from "lucide-react";
import { field, label as labelClass, noAutofill } from "./styles";
import { IconButton } from "./IconButton";

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
 * Safari and iOS only allow a clipboard write that starts inside the click. When the browser has
 * ClipboardItem, the write is started at once with the key still on its way (a promise of it), so fetching
 * the saved key first doesn't lose the click. Undefined when this browser has no such write.
 */
function writeLater(key: Promise<string>): Promise<void> | undefined {
  const Item = (window as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (!Item || !navigator.clipboard?.write) return undefined;
  const blob = key.then((k) => new Blob([k], { type: "text/plain" }));
  blob.catch(() => {}); // a failed fetch is reported by the caller
  try {
    return navigator.clipboard.write([new Item({ "text/plain": blob })]);
  } catch (e) {
    return Promise.reject(e);
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
 * readOnly + defaultShown: a key to look at and copy, not to type (a new API key, shown once it's made).
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
  onRevealChange,
  readOnly = false,
  defaultShown = false,
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
  onRevealChange?: (shown: boolean) => void; // a saved key is (or is no longer) shown in the box
  readOnly?: boolean;
  defaultShown?: boolean;
}) {
  const ownId = useId();
  const boxId = id ?? ownId;
  const [shown, setShown] = useState(defaultShown);
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

  const isRevealed = revealed !== null;
  useEffect(() => {
    onRevealChange?.(isRevealed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRevealed]);

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

  const copied2s = () => {
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  // Not async: the Safari write has to start before anything is awaited
  const copy = () => {
    setProblem(null);
    setCopied(false);
    setBusy(true);
    const done = () => setBusy(false);
    if (typed || revealed !== null || !saved) {
      void copyText(typed ? value : (revealed ?? ""))
        .then((ok) => (ok ? copied2s() : setProblem(COPY_FAILED)))
        .finally(done);
      return;
    }
    // The saved key: fetched, never shown
    const key = fetchSaved();
    key.catch(() => {}); // (handled below)
    const writing = writeLater(key);
    void (async () => {
      try {
        if (writing) {
          try {
            await writing;
            return copied2s();
          } catch {
            // refused, or the key didn't come: the fetch's own message, or the old ways
          }
        }
        const text = await key;
        if (await copyText(text)) copied2s();
        else setProblem(COPY_FAILED);
      } catch (e) {
        setProblem((e as Error).message || COPY_FAILED);
      } finally {
        done();
      }
    })();
  };

  const button = "flex min-w-10 items-center justify-center text-subtle hover:text-ink disabled:opacity-40";
  const box = (
    <div className={`relative ${showLabel ? "mt-1" : ""}`}>
      <input
        {...noAutofill}
        id={boxId}
        aria-label={label}
        type={shown ? "text" : "password"}
        autoComplete={autoComplete}
        spellCheck={false}
        readOnly={readOnly}
        value={typed ? value : (revealed ?? "")}
        placeholder={placeholder}
        onChange={(e) => {
          setRevealed(null); // edited: what's in the box is now a new key
          onChange(e.target.value);
        }}
        className={`${field} mt-0 min-w-0 font-mono placeholder:font-sans ${copied ? "pr-28" : "pr-21"} ${inputClassName}`}
      />
      <div className="absolute inset-y-0 right-0 flex">
        <IconButton label={`${shown ? "Hide" : "Show"} ${keyName}`} aria-pressed={shown} disabled={busy || !canUse} onClick={() => void toggle()} className={button}>
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </IconButton>
        <IconButton label={`Copy ${keyName}`} disabled={busy || !canUse} onClick={() => void copy()} className={`${button} rounded-r-xl px-2`}>
          {copied ? <span className="text-xs font-semibold text-success">Copied</span> : <Copy className="size-4" />}
        </IconButton>
      </div>
    </div>
  );
  return (
    <div className="min-w-0">
      {showLabel && (
        <label htmlFor={boxId} className={labelClass}>
          {label}
        </label>
      )}
      {box}
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
