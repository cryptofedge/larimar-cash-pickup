/**
 * Country configuration.
 *
 * The Dominican Republic is the first market, not a hardcoded assumption. Nothing
 * in money, fx, fees, ledger, pickup-code, or transaction-state mentions the DR —
 * they take a country config and behave accordingly. Adding Mexico is a
 * configuration change plus a licensed partner, not a refactor.
 *
 * `enabled: false` markets below are scaffolding. They are NOT operational and
 * carry no licensing, banking, or partner relationships.
 */

import { DomainError } from './errors';

export type PayoutMethod = 'CASH_PICKUP' | 'BANK_DEPOSIT' | 'MOBILE_WALLET';
export type FundingMethod = 'CARD_DEBIT' | 'CARD_CREDIT' | 'APPLE_PAY' | 'GOOGLE_PAY' | 'BANK_TRANSFER';
export type IdentityDocumentType = 'PASSPORT' | 'NATIONAL_ID' | 'DRIVERS_LICENSE' | 'RESIDENCE_PERMIT';

export interface CountryConfig {
  /** ISO-3166-1 alpha-2. */
  readonly code: string;
  readonly nameKey: string;
  readonly enabled: boolean;

  readonly payoutCurrency: string;
  readonly supportedFundingCurrencies: readonly string[];
  readonly supportedFundingMethods: readonly FundingMethod[];
  readonly supportedPayoutMethods: readonly PayoutMethod[];

  /** Two letters, prefixes every pickup code issued for this market. */
  readonly pickupCodePrefix: string;
  readonly pickupCodeTtlDays: number;
  readonly pickupCodeMaxAttempts: number;

  /** Documents a payout agent may accept. Order is presentation order. */
  readonly acceptedIdDocuments: readonly IdentityDocumentType[];

  readonly feeScheduleKey: string;
  readonly timezone: string;
  readonly quoteTtlSeconds: number;

  /**
   * Regulatory work required before this market can process real money.
   * Descriptive only — this is not legal advice and does not assert any
   * particular obligation applies.
   */
  readonly regulatoryNotes: readonly string[];
}

const DOMINICAN_REPUBLIC: CountryConfig = Object.freeze({
  code: 'DO',
  nameKey: 'country.do',
  enabled: true,

  payoutCurrency: 'DOP',
  supportedFundingCurrencies: Object.freeze(['USD']),
  supportedFundingMethods: Object.freeze(['CARD_DEBIT', 'CARD_CREDIT'] as const),
  supportedPayoutMethods: Object.freeze(['CASH_PICKUP'] as const),

  pickupCodePrefix: 'DR',
  pickupCodeTtlDays: 30,
  pickupCodeMaxAttempts: 5,

  acceptedIdDocuments: Object.freeze(['PASSPORT', 'NATIONAL_ID', 'DRIVERS_LICENSE'] as const),

  feeScheduleKey: 'do-standard',
  timezone: 'America/Santo_Domingo',
  quoteTtlSeconds: 900,

  regulatoryNotes: Object.freeze([
    'Requires legal analysis of Ley Monetaria y Financiera 183-02 and its scope for this model.',
    'Junta Monetaria and Banco Central authorisation questions must be resolved before any real-money operation.',
    'Superintendencia de Bancos supervision may apply depending on the structure chosen.',
    'AML/CFT obligations under Ley 155-17 require a compliance officer, a written programme, and reporting channels.',
    'Foreign-exchange operations may require separate authorisation as an exchange agent.',
    'An alternative structure is to operate as the technology layer for an already-licensed institution.',
  ]),
});

/** Scaffolded, disabled. No partner, no licence, no operational capability. */
const scaffold = (
  code: string,
  nameKey: string,
  payoutCurrency: string,
  prefix: string,
  timezone: string,
  feeScheduleKey: string,
): CountryConfig =>
  Object.freeze({
    code,
    nameKey,
    enabled: false,
    payoutCurrency,
    supportedFundingCurrencies: Object.freeze(['USD']),
    supportedFundingMethods: Object.freeze(['CARD_DEBIT', 'CARD_CREDIT'] as const),
    supportedPayoutMethods: Object.freeze(['CASH_PICKUP'] as const),
    pickupCodePrefix: prefix,
    pickupCodeTtlDays: 30,
    pickupCodeMaxAttempts: 5,
    acceptedIdDocuments: Object.freeze(['PASSPORT', 'NATIONAL_ID'] as const),
    feeScheduleKey,
    timezone,
    quoteTtlSeconds: 900,
    regulatoryNotes: Object.freeze([
      'Not operational. Requires local licensing analysis, a banking relationship, and a payout network before enablement.',
    ]),
  });

export const COUNTRIES: Readonly<Record<string, CountryConfig>> = Object.freeze({
  DO: DOMINICAN_REPUBLIC,
  MX: scaffold('MX', 'country.mx', 'MXN', 'MX', 'America/Mexico_City', 'mx-standard'),
  CO: scaffold('CO', 'country.co', 'COP', 'CO', 'America/Bogota', 'co-standard'),
  CR: scaffold('CR', 'country.cr', 'CRC', 'CR', 'America/Costa_Rica', 'cr-standard'),
  PA: scaffold('PA', 'country.pa', 'PAB', 'PA', 'America/Panama', 'pa-standard'),
  JM: scaffold('JM', 'country.jm', 'JMD', 'JM', 'America/Jamaica', 'jm-standard'),
  PR: scaffold('PR', 'country.pr', 'USD', 'PR', 'America/Puerto_Rico', 'pr-standard'),
});

export function getCountry(code: string): CountryConfig {
  const config = COUNTRIES[code.toUpperCase()];
  if (!config) {
    throw new DomainError('UNSUPPORTED_COUNTRY', `No configuration for country ${code}`);
  }
  return config;
}

export function getEnabledCountry(code: string): CountryConfig {
  const config = getCountry(code);
  if (!config.enabled) {
    throw new DomainError('UNSUPPORTED_COUNTRY', `${config.code} is not an operational market`);
  }
  return config;
}

export function enabledCountries(): CountryConfig[] {
  return Object.values(COUNTRIES).filter((c) => c.enabled);
}

export function allCountries(): CountryConfig[] {
  return Object.values(COUNTRIES);
}

export function isFundingCurrencySupported(country: CountryConfig, currency: string): boolean {
  return country.supportedFundingCurrencies.includes(currency.toUpperCase());
}

export const DEFAULT_COUNTRY_CODE = 'DO';
