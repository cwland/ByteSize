import { useCallback, useEffect, useState } from "react";
import { api, download, saveFile } from "../../api";
import { useSession } from "../../session";
import type { Backup, BackupList, RestoreResult } from "../../types";
import { Card } from "../ui/Card";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { field, label as labelClass, linkButton, primaryButton, secondaryButton } from "../ui/styles";

// Backup files are named bytesize-YYYY-MM-DD-HHMMSS[-before-restore].tar.gz
const isSafetyBackup = (name: string) => name.endsWith("-before-restore.tar.gz");
const backupPath = (name: string) => `/api/admin/backups/${encodeURIComponent(name)}`;

// 2516582 -> "2.4 MB"
function sizeText(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

const keysWarning = (keys: string[]) => `These saved keys couldn't be read with this server's secret and need entering again: ${keys.join(", ")}`;

// Settings › Data: everyone can download their own data; the admin also manages backups and restores
export default function DataSettings() {
  const { user } = useSession();
  return (
    <>
      <MyData />
      {user.isAdmin && <Backups />}
    </>
  );
}

function MyData() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function get() {
    setBusy(true);
    setMsg(null);
    try {
      saveFile(await download("/api/export"));
    } catch (e) {
      setMsg(errorMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Your data" description="A zip with your food log, weigh-ins, shots and foods as spreadsheets, plus everything else in one file.">
      <button type="button" onClick={() => void get()} disabled={busy} className={secondaryButton}>
        {busy ? "Preparing…" : "Download my data"}
      </button>
      <Notice msg={msg} />
    </Card>
  );
}

// What a restore will use: a backup on the server, or a file the admin picked
type Source = { kind: "server"; name: string } | { kind: "file"; file: File };

function Backups() {
  const { user, signOut } = useSession();
  const [list, setList] = useState<BackupList | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<Source | null>(null);
  const [restored, setRestored] = useState<RestoreResult | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await api<BackupList>("GET", "/api/admin/backups"));
    } catch (e) {
      setMsg(errorMsg(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  // One thing at a time: every button waits while one of these runs
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await work();
    } catch (e) {
      setMsg(errorMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const backUp = () =>
    run(async () => {
      const { backup } = await api<{ backup: Backup }>("POST", "/api/admin/backups");
      setList((l) => (l ? { ...l, backups: [backup, ...l.backups] } : l));
    });
  const get = (name: string) => run(async () => saveFile(await download(backupPath(name))));
  const remove = (name: string) =>
    run(async () => {
      await api("DELETE", backupPath(name));
      setList((l) => (l ? { ...l, backups: l.backups.filter((b) => b.name !== name) } : l));
      setDeleting(null);
    });
  const restore = (source: Source) =>
    run(async () => {
      const body = source.kind === "server" ? { name: source.name, confirm: "RESTORE" } : fileForm(source.file);
      setRestored(await api<RestoreResult>("POST", "/api/admin/backups/restore", body));
      setRestoring(null);
    });

  if (restored) {
    return (
      <Card title="Backups">
        <Notice msg={{ ok: true, text: "Restored. Sign in again to continue." }} />
        {restored.unreadableKeys.length > 0 && <Notice msg={{ ok: false, text: keysWarning(restored.unreadableKeys) }} />}
        <button type="button" onClick={signOut} className={`${primaryButton} mt-4`}>
          Sign in
        </button>
      </Card>
    );
  }

  const panel = (source: Source) => <RestorePanel busy={busy} onRestore={() => void restore(source)} onCancel={() => setRestoring(null)} />;

  return (
    <Card title="Backups" description={list ? `ByteSize backs up everything each night and keeps the newest ${list.keep}.` : undefined}>
      {list && list.unreadableKeys.length > 0 && <Notice msg={{ ok: false, text: keysWarning(list.unreadableKeys) }} />}
      <button type="button" onClick={() => void backUp()} disabled={busy} className={primaryButton}>
        Back up now
      </button>
      <Notice msg={msg} />
      {list === null ? (
        !msg && <p className="mt-4 text-muted">Loading…</p>
      ) : list.backups.length === 0 ? (
        <p className="mt-4 text-muted">No backups yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {list.backups.map((b) => (
            <li key={b.name} className="py-3">
              <p className="font-semibold">{new Date(b.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: user.timezone })}</p>
              <p className="text-sm text-muted">
                {sizeText(b.size)}
                {isSafetyBackup(b.name) && <span className="ml-2 rounded-full bg-pressed px-2 py-0.5 text-xs font-semibold text-subtle">before restore</span>}
              </p>
              {deleting === b.name ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="font-semibold">Delete this backup?</span>
                  <button type="button" onClick={() => void remove(b.name)} disabled={busy} className={`${linkButton} text-error`}>
                    Yes, delete
                  </button>
                  <button type="button" onClick={() => setDeleting(null)} disabled={busy} className={linkButton}>
                    Keep it
                  </button>
                </div>
              ) : (
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <button type="button" onClick={() => void get(b.name)} disabled={busy} className={linkButton}>
                    Download
                  </button>
                  <button type="button" onClick={() => setRestoring({ kind: "server", name: b.name })} disabled={busy} className={linkButton}>
                    Restore
                  </button>
                  <button type="button" onClick={() => setDeleting(b.name)} disabled={busy} className={linkButton}>
                    Delete
                  </button>
                </div>
              )}
              {restoring?.kind === "server" && restoring.name === b.name && panel(restoring)}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 border-t border-line pt-4">
        <label className={labelClass}>
          Restore from a file
          <input
            type="file"
            aria-label="Restore from a file"
            accept=".tar.gz,.tgz,application/gzip,application/x-gzip"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setRestoring({ kind: "file", file });
              e.target.value = "";
            }}
            className={`${field} text-sm`}
          />
        </label>
        {restoring?.kind === "file" && (
          <>
            <p className="mt-2 text-sm text-subtle break-all">{restoring.file.name}</p>
            {panel(restoring)}
          </>
        )}
      </div>
    </Card>
  );
}

function fileForm(file: File) {
  const form = new FormData();
  form.append("confirm", "RESTORE");
  form.append("file", file);
  return form;
}

// Restoring replaces every person's data, so it needs the word typed out
function RestorePanel({ busy, onRestore, onCancel }: { busy: boolean; onRestore: () => void; onCancel: () => void }) {
  const [typed, setTyped] = useState("");
  return (
    <div role="group" aria-label="Confirm restore" className="mt-3 rounded-xl border border-error p-3">
      <p className="text-sm">Restoring replaces everything on this server — every person's data — with this backup. A safety backup is saved first. Everyone will need to sign in again.</p>
      <label className={`${labelClass} mt-3`}>
        Type RESTORE to confirm
        <input aria-label="Type RESTORE to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" disabled={busy} className={field} />
      </label>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" onClick={onRestore} disabled={busy || typed !== "RESTORE"} className={`${primaryButton} bg-error text-white hover:bg-error`}>
          {busy ? "Restoring…" : "Restore"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={secondaryButton}>
          Cancel
        </button>
      </div>
    </div>
  );
}
