import { TIMEZONES } from "../../timezones";
import { field, label as labelClass } from "./styles";

export function TimezoneSelect({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  return (
    <label className={`${labelClass} mt-4`}>
      Time zone
      <select aria-label="Time zone" value={value} onChange={(e) => onChange(e.target.value)} className={field}>
        {TIMEZONES.map((tz) => (
          <option key={tz} value={tz}>
            {tz.replace(/_/g, " ")}
          </option>
        ))}
      </select>
      <span className="mt-1 block text-xs text-muted">Your days start and end at midnight here.</span>
    </label>
  );
}
