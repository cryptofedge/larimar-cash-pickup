import { NextResponse } from 'next/server';
import { defineRoute, jsonOk } from '@/server/http/api';
import { exportSettlementCsv, getSettlementBatch } from '@/server/services/settlement';

export const runtime = 'nodejs';

/**
 * One batch, with its lines.
 *
 * `?format=csv` returns the settlement statement a partner would reconcile
 * against. Amounts stay as integer minor-unit strings even in CSV — a
 * spreadsheet silently reformatting "20000.00" as a float is exactly the class
 * of error this codebase avoids everywhere else.
 */
export const GET = defineRoute({ permission: 'settlement.read' }, async ({ req, params }) => {
  const id = params.id as string;
  const format = new URL(req.url).searchParams.get('format');

  if (format === 'csv') {
    const { filename, csv } = await exportSettlementCsv(id);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  const batch = await getSettlementBatch(id);

  return jsonOk({
    id: batch.id,
    reference: batch.reference,
    institution: {
      name: batch.institution.name,
      code: batch.institution.code,
      isDemo: batch.institution.isDemo,
    },
    periodStart: batch.periodStart,
    periodEnd: batch.periodEnd,
    currency: batch.currency,
    payoutCount: batch.payoutCount,
    grossPayoutMinor: batch.grossPayoutMinor,
    commissionBps: batch.commissionBps,
    commissionMinor: batch.commissionMinor,
    netPayableMinor: batch.netPayableMinor,
    status: batch.status,
    partnerReportedMinor: batch.partnerReportedMinor,
    varianceMinor: batch.varianceMinor,
    varianceNote: batch.varianceNote,
    issuedAt: batch.issuedAt,
    reconciledAt: batch.reconciledAt,
    paidAt: batch.paidAt,
    paymentReference: batch.paymentReference,
    lines: batch.lines.map((line) => ({
      pickupEventId: line.pickupEventId,
      transactionRef: line.transactionRef,
      locationCode: line.locationCode,
      amountMinor: line.amountMinor,
      currency: line.currency,
      disbursedAt: line.disbursedAt,
    })),
  });
});
