import { useEffect, useState } from "react";
import { api, ApiError } from "../../api";
import type { Body, PlansResponse, SavedBody, Targets } from "../../types";
import BodyForm from "./BodyForm";
import PlanPicker from "./PlanPicker";
import TargetsEditor, { defaultsFor } from "../goals/TargetsEditor";
import { Notice, errorMsg, type Msg } from "../ui/Notice";
import { linkButton } from "../ui/styles";

type Step = { name: "loading" } | { name: "body" } | { name: "plans"; data: PlansResponse } | { name: "targets" };

export const REVIEW_MESSAGE = "We've updated a couple of questions — check your details";

// About you → plans → (or) your own targets. Used on first run, from Goals › Change plan and
// Goals › Edit my details (startAtDetails), and when saved details need a review (asked once,
// before plans; saving clears it on the server).
export default function PlanFlow({
  onDone,
  onCancel,
  cancelLabel = "Not now",
  startAtDetails = false,
}: {
  onDone: (t: Targets) => void;
  onCancel?: () => void;
  cancelLabel?: string;
  startAtDetails?: boolean;
}) {
  const [body, setBody] = useState<Body | null>(null);
  const [review, setReview] = useState(false);
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
    api<{ body: SavedBody | null }>("GET", "/api/body")
      .then((r) => {
        setBody(r.body);
        setReview(!!r.body?.needsReview);
        if (r.body && !r.body.needsReview && !startAtDetails) void loadPlans();
        else setStep({ name: "body" });
      })
      .catch((e) => {
        setMsg(errorMsg(e));
        setStep({ name: "body" });
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-3">
      {step.name === "body" && review && (
        <p role="status" className="rounded-2xl bg-active px-4 py-3 font-semibold text-ink">
          {REVIEW_MESSAGE}
        </p>
      )}
      {step.name === "body" && (
        <BodyForm
          initial={body}
          onSaved={(b) => {
            setBody(b);
            setReview(false);
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
