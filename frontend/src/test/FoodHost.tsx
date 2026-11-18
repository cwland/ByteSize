import { useDay } from "../day";
import { useSelectedDay } from "../selectedDay";
import FoodWidget from "../components/dashboard/FoodWidget";

// The Dashboard's Food widget on its own (what the Log page used to be), for screen tests of the meal cards
// and Add food. Inside a SelectedDayProvider.
export default function FoodHost() {
  const { day, isToday } = useSelectedDay();
  const { data } = useDay(day);
  return <FoodWidget day={day} data={data} isToday={isToday} />;
}
