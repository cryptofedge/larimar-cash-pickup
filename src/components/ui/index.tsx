/**
 * UI primitives.
 *
 * Small, unopinionated, server-component-safe. Nothing here holds state; the
 * interactive pieces live in their own client components so the marketing pages
 * ship no JavaScript they do not need.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { TransactionStatus } from '@/lib/domain/transaction-state';

export function Card({
  children,
  className = '',
  as: Component = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
}) {
  return <Component className={`card ${className}`}>{children}</Component>;
}

export function CardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`p-5 sm:p-6 ${className}`}>{children}</div>;
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-navy-100 px-5 py-4 sm:px-6">
      <div>
        <h2 className="text-base font-semibold text-navy-900">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-navy-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-navy-100 text-navy-700',
    success: 'bg-success-50 text-success-700',
    warning: 'bg-warning-50 text-warning-700',
    danger: 'bg-danger-50 text-danger-700',
    info: 'bg-larimar-100 text-larimar-800',
  };
  return <span className={`badge ${tones[tone]} ${className}`}>{children}</span>;
}

/** Maps a transaction status to a colour that matches its real-world meaning. */
export function StatusBadge({ status, label }: { status: TransactionStatus; label: string }) {
  const tone: Record<TransactionStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
    CREATED: 'neutral',
    CUSTOMER_DETAILS_REQUIRED: 'warning',
    KYC_REQUIRED: 'warning',
    KYC_PENDING: 'info',
    KYC_APPROVED: 'info',
    KYC_REJECTED: 'danger',
    PAYMENT_PENDING: 'warning',
    PAYMENT_AUTHORIZED: 'info',
    PAYMENT_FAILED: 'danger',
    COMPLIANCE_REVIEW: 'warning',
    READY_FOR_PICKUP: 'success',
    PARTIALLY_PICKED_UP: 'info',
    PICKED_UP: 'success',
    EXPIRED: 'neutral',
    CANCELLED: 'neutral',
    REFUNDED: 'neutral',
    DISPUTED: 'danger',
  };
  return <Badge tone={tone[status]}>{label}</Badge>;
}

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title?: string;
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    info: 'border-larimar-200 bg-larimar-50 text-larimar-900',
    warning: 'border-warning-500/30 bg-warning-50 text-warning-700',
    danger: 'border-danger-500/30 bg-danger-50 text-danger-700',
    success: 'border-success-500/30 bg-success-50 text-success-700',
  };
  return (
    <div className={`rounded-xl border p-4 text-sm ${tones[tone]}`} role="status">
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

/**
 * The mandatory demo-location notice.
 *
 * Rendered wherever a pickup location appears. Not dismissible, not subtle — a
 * reader must never mistake a fictional branch for a real banking partner.
 */
export function DemoLocationBanner({ label, explanation }: { label: string; explanation?: string }) {
  return (
    <div className="rounded-lg border border-warning-500/40 bg-warning-50 px-3 py-2">
      <p className="text-xs font-bold uppercase tracking-wide text-warning-700">{label}</p>
      {explanation ? <p className="mt-1 text-xs text-warning-700/90">{explanation}</p> : null}
    </div>
  );
}

export function AmountRow({
  label,
  value,
  emphasis = false,
  muted = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={`amount-row ${emphasis ? 'border-t border-navy-200 pt-3 text-base' : 'text-sm'}`}>
      <span className={muted ? 'text-navy-400' : ''}>{label}</span>
      <span className={`amount-row-value ${emphasis ? 'text-lg' : ''} ${muted ? 'text-navy-500' : ''}`}>
        {value}
      </span>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-medium text-navy-700">{title}</p>
      {description ? <p className="mt-1 text-sm text-navy-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ButtonLink({
  href,
  children,
  variant = 'primary',
  className = '',
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  className?: string;
}) {
  const variants = { primary: 'btn-primary', secondary: 'btn-secondary', ghost: 'btn-ghost' };
  return (
    <Link href={href} className={`${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1 text-navy-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const tones: Record<string, string> = {
    neutral: 'text-navy-900',
    success: 'text-success-700',
    warning: 'text-warning-700',
    danger: 'text-danger-600',
  };
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-navy-400">{label}</p>
      <p className={`tabular mt-1.5 text-2xl font-bold ${tones[tone]}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-navy-400">{hint}</p> : null}
    </div>
  );
}

/**
 * A dependency-free horizontal bar chart.
 *
 * Deliberately not a charting library: this renders on the server, ships zero
 * JavaScript, and stays readable at 375px. A CSP that forbids third-party
 * scripts makes most chart libraries awkward anyway.
 */
export function BarChart({
  data,
  formatValue,
  emptyLabel,
}: {
  data: { label: string; value: number }[];
  formatValue?: (value: number) => string;
  emptyLabel: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const hasData = data.some((d) => d.value > 0);

  if (!hasData) {
    return <p className="py-6 text-center text-sm text-navy-400">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-2">
      {data.map((point) => (
        <div key={point.label} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-xs text-navy-500" title={point.label}>
            {point.label}
          </span>
          <div className="h-5 flex-1 overflow-hidden rounded bg-navy-50">
            <div
              className="h-full rounded bg-larimar-500"
              style={{ width: `${Math.max(2, (point.value / max) * 100)}%` }}
            />
          </div>
          <span className="tabular w-24 shrink-0 text-right text-xs font-medium text-navy-700">
            {formatValue ? formatValue(point.value) : point.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Sparkline-style column chart for a daily time series. */
export function ColumnChart({
  data,
  formatValue,
  emptyLabel,
}: {
  data: { label: string; value: number }[];
  formatValue?: (value: number) => string;
  emptyLabel: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  if (!data.some((d) => d.value > 0)) {
    return <p className="py-6 text-center text-sm text-navy-400">{emptyLabel}</p>;
  }

  return (
    <div className="flex h-32 items-end gap-[3px] overflow-x-auto">
      {data.map((point) => (
        <div
          key={point.label}
          className="group relative flex min-w-[6px] flex-1 flex-col justify-end"
          title={`${point.label}: ${formatValue ? formatValue(point.value) : point.value}`}
        >
          <div
            className="rounded-t bg-larimar-500 transition-colors group-hover:bg-larimar-700"
            style={{ height: `${Math.max(3, (point.value / max) * 100)}%` }}
          />
        </div>
      ))}
    </div>
  );
}
