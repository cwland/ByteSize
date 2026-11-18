import { useSession } from "../../session";
import AiSettings from "./AiSettings";
import CulurySettings from "./CulurySettings";
import { FatSecretSettings, OpenFoodFactsSettings, SpoonacularSettings, UsdaSettings, useSourceKeys } from "./FoodSourcesSettings";

// Settings › Integrations: every outside service in one place, a card each with its on/off switch in the
// title row (on = open and used; off = closed and never asked). The server-wide ones (AI services, Open Food
// Facts, USDA, FatSecret, Spoonacular) are the admin's; members see only their own Culury link (and never
// ask for the admin cards).
export default function IntegrationsSettings() {
  const { user } = useSession();
  return (
    <>
      {user.isAdmin && <AdminSections />}
      <CulurySettings />
    </>
  );
}

// The server-wide services; the food-source summary is fetched once for its four cards
function AdminSections() {
  const sources = useSourceKeys();
  return (
    <>
      <AiSettings />
      <OpenFoodFactsSettings sources={sources} />
      <UsdaSettings sources={sources} />
      <FatSecretSettings sources={sources} />
      <SpoonacularSettings sources={sources} />
    </>
  );
}
