import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";

type Outputs = inferRouterOutputs<AppRouter>;

export type DealsAdminOutputs = Outputs["deals"]["admin"];
export type Overview = DealsAdminOutputs["overview"];
export type CommunityRow = Overview["communities"][number];
export type HomeRow = Overview["homes"][number];
export type PhotoRow = Overview["photos"][number];
export type IncentiveRow = Overview["incentives"][number];
export type TeamRow = Overview["team"][number];
export type Settings = DealsAdminOutputs["settings"];
export type Diagnostics = DealsAdminOutputs["communityDiagnostics"];
export type CommunityDiagnostics = Diagnostics[number];
export type HeldIncentive = CommunityDiagnostics["heldIncentives"][number];
export type BuilderPhotoSettingsView = DealsAdminOutputs["builderPhotoSettings"][number];
export type LeadsPage = DealsAdminOutputs["leads"];
export type LeadRow = LeadsPage["rows"][number];
export type LeadDetail = DealsAdminOutputs["leadDetail"];
export type Health = DealsAdminOutputs["health"];
