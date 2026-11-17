// A short result line: green when it worked, red (and announced) when it didn't
export type Msg = { ok: boolean; text: string } | null;

export function Notice({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? "status" : "alert"} className={`mt-3 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-success-subtle text-success" : "bg-error-subtle text-error"}`}>
      {msg.text}
    </p>
  );
}

export const errorMsg = (e: unknown): Msg => ({ ok: false, text: (e as Error)?.message || "Something went wrong" });
