/**
 * Regression guard for the Content-Security-Policy.
 *
 * An earlier revision set a static `script-src 'self'`. That blocks the inline
 * RSC payload scripts the App Router streams, so React never hydrated and every
 * page rendered blank — while typecheck, lint, and the production build all
 * passed. Only a real browser caught it.
 *
 * These tests pin the two properties that matter and would each have caught the
 * original defect: a nonce must be present, and the policy must never fall back
 * to `'unsafe-inline'` for scripts.
 */

import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

function cspFor(url = 'http://localhost:3000/'): string {
  // Arrange
  const request = new NextRequest(new Request(url));

  // Act
  const response = middleware(request);

  // Assert (caller asserts on the returned policy)
  return response.headers.get('content-security-policy') ?? '';
}

function directive(csp: string, name: string): string {
  const found = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));
  return found ?? '';
}

describe('middleware csp', () => {
  it('test_csp_response_includes_script_nonce', () => {
    // Arrange / Act
    const csp = cspFor();

    // Assert
    expect(directive(csp, 'script-src')).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
  });

  it('test_csp_script_src_never_allows_unsafe_inline', () => {
    // Arrange / Act
    const scriptSrc = directive(cspFor(), 'script-src');

    // Assert — the tempting "quick fix" for the original bug, permanently barred.
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('test_csp_script_src_includes_strict_dynamic_for_chunk_loading', () => {
    // Arrange / Act
    const scriptSrc = directive(cspFor(), 'script-src');

    // Assert — without this the nonced bootstrap cannot load its chunks.
    expect(scriptSrc).toContain("'strict-dynamic'");
  });

  it('test_csp_nonce_is_unique_per_request', () => {
    // Arrange / Act
    const first = directive(cspFor(), 'script-src');
    const second = directive(cspFor(), 'script-src');

    // Assert — a reused nonce is equivalent to no nonce at all.
    expect(first).not.toBe(second);
  });

  it('test_csp_sets_nonce_on_request_headers_for_next_to_consume', () => {
    // Arrange
    const request = new NextRequest(new Request('http://localhost:3000/'));

    // Act
    const response = middleware(request);
    const csp = response.headers.get('content-security-policy') ?? '';
    const match = /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp);

    // Assert — Next reads the policy off the REQUEST to stamp its inline
    // scripts. If that plumbing breaks, hydration silently dies again.
    expect(match).not.toBeNull();
    expect(response.headers.get('content-security-policy')).toContain(match?.[1] ?? 'MISSING');
  });

  it('test_csp_forbids_framing_and_object_embedding', () => {
    // Arrange / Act
    const csp = cspFor();

    // Assert
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it('test_csp_restricts_connections_and_forms_to_same_origin', () => {
    // Arrange / Act
    const csp = cspFor();

    // Assert — no third-party origin may receive data from this application.
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("default-src 'self'");
  });
});

describe('middleware security headers', () => {
  it('test_security_headers_present_on_every_response', () => {
    // Arrange
    const request = new NextRequest(new Request('http://localhost:3000/'));

    // Act
    const response = middleware(request);

    // Assert
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
  });

  it('test_permissions_policy_disables_camera_microphone_and_payment', () => {
    // Arrange
    const request = new NextRequest(new Request('http://localhost:3000/'));

    // Act
    const policy = middleware(request).headers.get('permissions-policy') ?? '';

    // Assert
    expect(policy).toContain('camera=()');
    expect(policy).toContain('microphone=()');
    expect(policy).toContain('payment=()');
  });
});
