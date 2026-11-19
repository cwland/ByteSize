import { useState } from "react";
import { Camera } from "lucide-react";
import { useDay, useSettingsMe } from "../../day";
import { mealFor } from "../../meals";
import { useSelectedDay } from "../../selectedDay";
import { useSession } from "../../session";
import type { Meal } from "../../types";
import { useWide } from "../../wide";
import AddFoodSheet from "../log/AddFoodSheet";
import { usePhotoInput } from "../log/PhotoPicker";
import { DayHeader } from "../PageHeader";
import { Notice } from "../ui/Notice";
import { secondaryButton } from "../ui/styles";
import NewBadge from "./NewBadge";
import { EditLayoutButton, WidgetColumns, useWidgetLayout } from "./WidgetPage";
import type { WidgetProps } from "./widgets";

// The Dashboard (§28): the selected day as widgets in three columns (two or one as the window narrows; one
// column in reading order on phones), from the person's saved layout or the default. "Edit dashboard" turns
// the widgets into cards that can be dragged within and across columns, moved with buttons, removed and added
// back (Add widget); Save stores the layout, Cancel puts it back, Reset to default restores the default.
// The new badge and other notices sit above the columns. Wide screens: a header with the day and week strip.
export default function Dashboard() {
  const { user } = useSession();
  const { day, isToday } = useSelectedDay();
  const wide = useWide();
  const { data, error } = useDay(day);
  const settings = useSettingsMe();
  const layout = useWidgetLayout("dashboard");
  const editing = layout.editing !== null;
  // Phones: Photo opens the file picker straight away; the chosen photo then opens Add Food for the meal of the moment
  const [photo, setPhoto] = useState<{ file: File; meal: Meal } | null>(null);
  const photoInput = usePhotoInput((file) => setPhoto({ file, meal: mealFor(user.timezone, new Date(), settings.mealWindows) }));

  const props: WidgetProps = { day, data, isToday, wide };
  const editButton = editing ? null : <EditLayoutButton layout={layout} />;
  const body = <WidgetColumns layout={layout} props={props} />;

  return (
    <div className={`flex flex-col ${wide ? "gap-4" : "gap-3"}`}>
      {wide ? <DayHeader>{editButton}</DayHeader> : <h1 className="sr-only">Dashboard</h1>}
      {error && <Notice msg={{ ok: false, text: error }} />}
      {!editing && <NewBadge />}
      {!wide && !editing && (
        <div className="flex items-center gap-2">
          {photoInput.input}
          <button type="button" onClick={photoInput.open} className={`${secondaryButton} inline-flex items-center gap-1.5`}>
            <Camera aria-hidden="true" className="size-5" /> Photo
          </button>
          <span className="ml-auto">{editButton}</span>
        </div>
      )}
      {body}
      {photo && <AddFoodSheet day={day} meal={photo.meal} photo={photo.file} onClose={() => setPhoto(null)} />}
    </div>
  );
}
