import { useEffect, useState } from "react";
import { api } from "../../api";
import type { Glp1View } from "../../types";
import { mg } from "../glp1/glp1";
import WeightSection from "../weight/WeightSection";
import type { ChartMarker } from "../weight/WeightChart";
import { useGoals } from "./goalsContext";

// Goals › Weight: the weight section, with each GLP-1 dose marked on the chart (GLP-1 set up only; failing: no
// markers). "Check your plan" opens the plan picker.
export default function GoalsWeight() {
  const goals = useGoals();
  const [doseMarkers, setDoseMarkers] = useState<ChartMarker[]>([]);
  useEffect(() => {
    let live = true;
    api<Glp1View>("GET", "/api/glp1")
      .then((v) => live && v.settings && setDoseMarkers(v.doseHistory.map((d) => ({ day: d.day, label: mg(d.doseMg), name: `dose ${mg(d.doseMg)}` }))))
      .catch(() => {});
    return () => void (live = false);
  }, []);
  return <WeightSection onReplan={() => goals?.setMode("plan")} markers={doseMarkers} />;
}
