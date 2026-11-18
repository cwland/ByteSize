import { useSession } from "../../session";
import AiSettings from "./AiSettings";
import CulurySettings from "./CulurySettings";
import { FatSecretSettings, OpenFoodFactsSettings, SpoonacularSettings, UsdaSettings, useSourceKeys } from "./FoodSourcesSettings";
import { LookupOrder } from "./LookupOrder";
import { SavedBarcodes } from "./SavedBarcodes";

// Settings › Integrations: every outside service in one place, a card each with its on/off switch in the
// title row (on = open and used; off = closed and never asked). The server-wide ones (AI services, Open Food
// Facts, USDA, FatSecret, Spoonacular) are the admin's; members see only their own Culury link (and never
// ask for the admin cards). Admins also get the lookup order at the top and Saved barcodes after the sources.
export default function IntegrationsSettings() {
  const { user } = useSession();
  return (
    <>
      {user.isAdmin && <AdminSections />}
      <CulurySettings />
    </>
  );
}

// The server-wide services; the food-source summary is fetched once for the order table and its four cards
function AdminSections() {
  const sources = useSourceKeys();
  return (
    <>
      <LookupOrder sources={sources} />
      <AiSettings />
      <OpenFoodFactsSettings sources={sources} />
      <UsdaSettings sources={sources} />
      <FatSecretSettings sources={sources} />
      <SpoonacularSettings sources={sources} />
      <SavedBarcodes />
    </>
  );
}
