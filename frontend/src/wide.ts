import { useEffect, useState } from "react";

// Wide screens (Tailwind's lg, 1024 px and up) get the side rail, page headers, multi-column pages and
// Settings tabs. Where only spacing differs, components use lg: classes; where the structure differs,
// useWide(). Without matchMedia (jsdom in tests) it is false: the phone layout.
export const WIDE_QUERY = "(min-width: 1024px)";

const media = () => (typeof window.matchMedia === "function" ? window.matchMedia(WIDE_QUERY) : null);

export function useWide() {
  const [wide, setWide] = useState(() => media()?.matches ?? false);
  useEffect(() => {
    const mq = media();
    if (!mq) return;
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}
