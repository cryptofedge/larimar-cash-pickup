import { defineRoute, jsonOk } from '@/server/http/api';
import { listLocationsSchema } from '@/lib/validation/schemas';
import { listPickupLocations } from '@/server/services/pickup';

export const runtime = 'nodejs';

/** Public directory. A traveler must be able to check coverage before signing up. */
export const GET = defineRoute(
  { permission: null, schema: listLocationsSchema, source: 'query' },
  async ({ body }) => {
    const locations = await listPickupLocations({
      countryCode: body.countryCode,
      city: body.city,
      query: body.q,
      limit: body.limit,
    });

    return jsonOk({
      locations: locations.map((l) => ({
        id: l.id,
        code: l.code,
        branchName: l.branchName,
        institutionName: l.institution.name,
        addressLine1: l.addressLine1,
        city: l.city,
        province: l.province,
        countryCode: l.countryCode,
        latitude: l.latitude,
        longitude: l.longitude,
        openingHours: l.openingHours,
        timezone: l.timezone,
        supportedCurrencies: l.supportedCurrencies,
        maxPayoutMinor: l.maxPayoutMinor,
        status: l.status,
        contactPhone: l.contactPhone,
        // Always present, always true in this build. Drives the mandatory banner.
        isDemo: l.institution.isDemo,
        demoNotice: l.institution.isDemo ? 'DEMO LOCATION — NOT A REAL PARTNER' : null,
      })),
    });
  },
);
