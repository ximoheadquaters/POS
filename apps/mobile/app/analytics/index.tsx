import { ReportsWorkspaceScreen } from '@/screens/reports-workspace';

/**
 * Charts and visual exploration live outside the formal Reports module.
 * The underlying read model remains shared so analytics never changes the
 * canonical report calculations.
 */
export default function AnalyticsRoute() {
  return <ReportsWorkspaceScreen initialSection="overview" workspaceTitle="Analytics" />;
}
