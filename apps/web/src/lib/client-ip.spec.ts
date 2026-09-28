import { describe, expect, it } from 'vitest';
import { clientIpFrom } from './client-ip';

describe('clientIpFrom', () => {
  it('passes an IPv4 or IPv6 address through', () => {
    expect(clientIpFrom('203.0.113.7')).toBe('203.0.113.7');
    expect(clientIpFrom(' 2001:db8::1 ')).toBe('2001:db8::1');
  });

  it('gives nothing for a missing, empty or malformed header', () => {
    expect(clientIpFrom(null)).toBeUndefined();
    expect(clientIpFrom(undefined)).toBeUndefined();
    expect(clientIpFrom('')).toBeUndefined();
    expect(clientIpFrom('999.1.1.1')).toBeUndefined();
    expect(clientIpFrom('not-an-address')).toBeUndefined();
    expect(clientIpFrom('203.0.113.7, 198.51.100.1')).toBeUndefined();
  });
});
