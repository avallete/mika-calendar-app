import { cookies } from "next/headers";

import { ScheduleWorkbench } from "@/components/planner/schedule-workbench";
import {
  getDefaultPlannerViewportPreferences,
  PLANNER_VIEWPORT_PREFERENCES_COOKIE_NAME,
  readPlannerViewportPreferencesFromCookie,
} from "@/lib/planner/viewport-preferences";

export default async function Home() {
  const cookieStore = await cookies();
  const initialViewportPreferences = readPlannerViewportPreferencesFromCookie(
    cookieStore.get(PLANNER_VIEWPORT_PREFERENCES_COOKIE_NAME)?.value,
    getDefaultPlannerViewportPreferences()
  );

  return (
    <ScheduleWorkbench initialViewportPreferences={initialViewportPreferences} />
  );
}
