import { defineRoute, jsonOk } from '@/server/http/api';
import {
  getDashboardMetrics,
  getGeographicDistribution,
  getStatusDistribution,
  getVolumeSeries,
} from '@/server/services/admin';

export const runtime = 'nodejs';

export const GET = defineRoute({ permission: 'admin.dashboard.read' }, async () => {
  const [metrics, volume, statuses, geography] = await Promise.all([
    getDashboardMetrics(),
    getVolumeSeries(30),
    getStatusDistribution(),
    getGeographicDistribution(),
  ]);

  return jsonOk({ metrics, volume, statuses, geography });
});
