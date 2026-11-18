import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera } from "lucide-react";
import { api } from "../../api";
import type { FoodResult, PhotoDraft, PhotoMode, PhotoResult } from "../../types";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { primaryButton, secondaryButton } from "../ui/styles";

export const NO_LABEL_READING = "Add an AI service that reads photos to read labels";
export const MAX_PHOTOS = 2; // a barcode photo and a label photo

/** Sends 1–2 photos to be read: a barcode is looked up, else a nutrition label is read into a draft. */
export function analyzePhotos(files: File[], mode: PhotoMode): Promise<PhotoResult> {
  const form = new FormData();
  form.append("mode", mode);
  for (const f of files) form.append("images", f, f.name);
  return api<PhotoResult>("POST", "/api/photos/analyze", form);
}

/**
 * A hidden file input (images only: an iPhone offers camera or library) and a way to open it from a
 * button. One per screen, so the tests and screen readers find a single "Photo file".
 */
export function usePhotoInput(onFile: (f: File) => void): { open: () => void; input: ReactNode } {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      aria-label="Photo file"
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = ""; // the same photo can be chosen again
        if (f) onFile(f);
      }}
    />
  );
  return { open: () => ref.current?.click(), input };
}

// The photo step of Add Food. With no photo yet: choose one (barcode or label) or "Read a label"; the
// photo chosen is sent in the step's mode ("auto", or "barcode" from Add food › barcode › Upload a barcode photo).
// With photos: sends them; a found food or a label draft is handed back, anything else is explained
// here with the next steps (add a second photo, try another, or create the food by hand). In barcode mode
// (Add food › barcode › Upload a barcode photo) a photo with no barcode offers another photo or typing the
// number (onTypeNumber).
export default function PhotoPicker({
  files,
  mode,
  onSend,
  onFood,
  onDraft,
  onCreate,
  onTypeNumber,
}: {
  files: File[];
  mode: PhotoMode;
  onSend: (files: File[], mode: PhotoMode) => void;
  onFood: (food: FoodResult) => void;
  onDraft: (draft: PhotoDraft, files: File[]) => void;
  onCreate: (barcode: string | null) => void;
  onTypeNumber?: () => void;
}) {
  const [photosOn, setPhotosOn] = useState<boolean | null>(null);
  const [result, setResult] = useState<PhotoResult | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const next = useRef<(f: File) => void>(() => {});
  const photo = usePhotoInput((f) => next.current(f));
  const choose = (then: (f: File) => void) => {
    next.current = then;
    photo.open();
  };

  useEffect(() => {
    let live = true;
    api<{ photos: boolean }>("GET", "/api/ai/status").then((s) => live && setPhotosOn(!!s.photos), () => {});
    return () => void (live = false);
  }, []);

  // The latest handlers, so an answer that arrives later uses the sheet's current state
  const handlers = useRef({ onFood, onDraft });
  handlers.current = { onFood, onDraft };

  // One upload per set of photos, even when React runs the effect twice in development
  const sentFor = useRef<{ files: File[]; mode: PhotoMode; out: Promise<PhotoResult> } | null>(null);
  useEffect(() => {
    if (!files.length) return;
    let live = true;
    if (sentFor.current?.files !== files || sentFor.current.mode !== mode) sentFor.current = { files, mode, out: analyzePhotos(files, mode) };
    setBusy(true);
    setResult(null);
    setMsg(null);
    sentFor.current.out.then(
      (r) => {
        if (!live) return;
        setBusy(false);
        if (r.food) handlers.current.onFood(r.food);
        else if (r.draft) handlers.current.onDraft(r.draft, files);
        else {
          setResult(r);
          if (r.labelReading === false) setPhotosOn(false);
        }
      },
      (e) => {
        if (!live) return;
        setBusy(false);
        setMsg(errorMsg(e));
      },
    );
    return () => void (live = false);
  }, [files, mode]);

  const again = (m: PhotoMode) => choose((f) => onSend([f], m));
  const plural = files.length > 1;

  return (
    <div className="flex flex-col gap-3">
      {photo.input}
      {!files.length && (
        <>
          <p className="text-subtle">Take or choose a photo of a barcode or a nutrition label.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => again(mode)} className={`${primaryButton} inline-flex items-center gap-1.5`}>
              <Camera aria-hidden="true" className="size-5" /> Choose a photo
            </button>
            {photosOn && (
              <button type="button" onClick={() => again("label")} className={secondaryButton}>
                Read a label
              </button>
            )}
          </div>
        </>
      )}
      {photosOn === false && <p className="text-sm text-muted">{NO_LABEL_READING}</p>}
      {busy && (
        <p role="status" className="text-subtle">
          {plural ? "Reading your photos…" : "Reading your photo…"}
        </p>
      )}
      <Notice msg={msg} />
      {result && (
        <>
          {(result.barcode || mode !== "label") && (
            <p className="text-subtle">{result.barcode ? `Nothing has barcode ${result.barcode} yet.` : plural ? "No barcode found in those photos." : "No barcode found in that photo."}</p>
          )}
          {result.errors.map((e) => (
            <p key={`${e.source}${e.message}`} className="text-sm text-muted">
              {e.message}
            </p>
          ))}
          {mode === "barcode" && !result.barcode ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => again("barcode")} className={primaryButton}>
                Try another photo
              </button>
              {onTypeNumber && (
                <button type="button" onClick={onTypeNumber} className={secondaryButton}>
                  Type the number
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {files.length < MAX_PHOTOS &&
                (result.barcode ? (
                  result.labelReading && (
                    <button type="button" onClick={() => choose((f) => onSend([...files, f], "auto"))} className={primaryButton}>
                      Add a label photo
                    </button>
                  )
                ) : (
                  <button type="button" onClick={() => choose((f) => onSend([...files, f], "auto"))} className={primaryButton}>
                    Add a barcode photo
                  </button>
                ))}
              <button type="button" onClick={() => onCreate(result.barcode ?? null)} className={secondaryButton}>
                Create food
              </button>
              <button type="button" onClick={() => again(mode === "barcode" ? "barcode" : "auto")} className={secondaryButton}>
                Try another photo
              </button>
            </div>
          )}
        </>
      )}
      {msg && !busy && (
        <button type="button" onClick={() => again(mode)} className={`${secondaryButton} self-start`}>
          Try another photo
        </button>
      )}
    </div>
  );
}
