import { useEffect, useState } from "react";
import { api, ApiError } from "../../api";
import type { Body, PlansResponse, Targets } from "../../types";
import BodyForm from "./BodyForm";
import PlanPicker from "./PlanPicker";
import TargetsEditor, { defaultsFor } from "../goals/TargetsEditor";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { linkButton } from "../ui/styles";

type Step = { name: "loading" } | { name: "body" } | { name: "plans"; data: PlansResponse } | { name: "targets" };

// About you → plans → (or) your own targets. Used on first run and from Goals › Change plan.
export default function PlanFlow({ onDone, onCancel, cancelLabel = "Not now" }: { onDone: (t: Targets) => void; onCancel?: () => void; cancelLabel?: string }) {
  const [body, setBody] = useState<Body | null>(null);
  const [step, setStep] = useState<Step>({ name: "loading" });
  const [msg, setMsg] = useState<Msg>(null);

  const loadPlans = async () => {
    try {
      setStep({ name: "plans", data: await api<PlansResponse>("GET", "/api/plans") });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) return setStep({ name: "body" });
      setMsg(errorMsg(e));
    }
  };

  useEffect(() => {
    api<{ body: Body | null }>("GET", "/api/body")
      .then((r) => {
        setBody(r.body);
        if (r.body) void loadPlans();
        else setStep({ name: "body" });
      })
      .catch((e) => {
        setMsg(errorMsg(e));
        setStep({ name: "body" });
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-3">
      {step.name === "body" && (
        <BodyForm
          initial={body}
          onSaved={(b) => {
            setBody(b);
            void loadPlans();
          }}
        />
      )}
      {step.name === "plans" && <PlanPicker data={step.data} onSelected={onDone} onOwnTargets={() => setStep({ name: "targets" })} />}
      {step.name === "targets" && <TargetsEditor initial={defaultsFor(body)} onSaved={onDone} onCancel={() => void loadPlans()} />}
      <Notice msg={msg} />
      <div className="flex justify-center gap-6">
        {step.name === "plans" && (
          <button type="button" className={linkButton} onClick={() => setStep({ name: "body" })}>
            Edit my details
          </button>
        )}
        {onCancel && (
          <button type="button" className={linkButton} onClick={onCancel}>
            {cancelLabel}
          </button>
        )}
      </div>
    </div>
  );
}
