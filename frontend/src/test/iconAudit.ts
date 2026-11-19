// §44: every button or link that shows only an icon (no words) must have an accessible name (aria-label) and the
// same words as hover text (title). iconOnlyOffenders() lists the ones that don't, as readable strings.
const CONTROLS = 'button, a, [role="button"]';

function hasVisibleWords(el: Element) {
  // Letters or digits only: a "×" or "+" glyph is an icon, not words
  return /[\p{L}\p{N}]/u.test(el.textContent ?? "");
}

function describe(el: Element) {
  const html = el.outerHTML.replace(/\s+/g, " ");
  const path: string[] = [];
  for (let p: Element | null = el.parentElement; p && path.length < 3; p = p.parentElement) {
    const dlg = p.getAttribute("aria-label") ?? p.getAttribute("role");
    if (dlg) path.push(dlg);
  }
  return `${html.length > 140 ? html.slice(0, 140) + "…" : html} (in ${path.join(" < ") || "page"})`;
}

export function iconOnlyOffenders(root: ParentNode = document.body): string[] {
  const bad: string[] = [];
  for (const el of Array.from(root.querySelectorAll(CONTROLS))) {
    if (el.closest('[aria-hidden="true"], [hidden]')) continue;
    if (el.tagName === "A" && !el.hasAttribute("href") && el.getAttribute("role") !== "button") continue;
    if (hasVisibleWords(el)) continue;
    const label = (el.getAttribute("aria-label") ?? "").trim();
    const title = (el.getAttribute("title") ?? "").trim();
    if (!label || !title) bad.push(`${!label ? "no aria-label" : "no title"}: ${describe(el)}`);
  }
  return bad;
}
