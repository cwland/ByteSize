import { useSession } from "../../session";
import AiSettings from "./AiSettings";
import CulurySettings from "./CulurySettings";
import { FoodDatabasesSettings, RestaurantMenusSettings, useSourceKeys } from "./FoodSourcesSettings";

// Settings › Integrations: every outside service in one place, a titled card each. The server-wide ones
// (AI services, food databases, restaurant menus) are the admin's; members see only their own Culury link
// (and never ask for the admin sections).
export default function IntegrationsSettings() {
  const { user } = useSession();
  return (
    <>
      {user.isAdmin && <AdminSections />}
      <CulurySettings />
    </>
  );
}

// The server-wide services; the food-source summary is fetched once for both of its cards
function AdminSections() {
  const sources = useSourceKeys();
  return (
    <>
      <AiSettings />
      <FoodDatabasesSettings sources={sources} />
      <RestaurantMenusSettings sources={sources} />
    </>
  );
}
