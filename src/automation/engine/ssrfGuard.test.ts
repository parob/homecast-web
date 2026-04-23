import { describe, it, expect } from 'vitest';
import { assertSafeOutboundUrl } from './ssrfGuard';

describe('assertSafeOutboundUrl', () => {
  describe('allows public URLs', () => {
    const allowed = [
      'https://api.github.com',
      'https://example.com/foo',
      'http://8.8.8.8/',
      'https://[2001:4860:4860::8888]/',
      'https://example.co.uk/path?q=1',
    ];
    for (const url of allowed) {
      it(url, () => expect(() => assertSafeOutboundUrl(url)).not.toThrow());
    }
  });

  describe('blocks non-http schemes', () => {
    const blocked = [
      'file:///etc/passwd',
      'ftp://example.com/',
      'data:text/plain,hi',
      'javascript:alert(1)',
      'chrome://settings',
      'about:blank',
    ];
    for (const url of blocked) {
      it(url, () => expect(() => assertSafeOutboundUrl(url)).toThrow(/scheme/));
    }
  });

  describe('blocks IPv4 private / loopback / link-local', () => {
    const blocked = [
      'http://127.0.0.1/',
      'http://127.1.2.3/',
      'http://10.0.0.5/',
      'http://10.255.255.254/',
      'http://172.16.0.1/',
      'http://172.31.255.254/',
      'http://192.168.0.1/',
      'http://169.254.169.254/',
      'http://0.0.0.0/',
      'http://100.64.1.1/',         // CGNAT
      'http://224.0.0.1/',          // multicast
      'http://239.255.255.250/',    // SSDP multicast
      'http://255.255.255.255/',
    ];
    for (const url of blocked) {
      it(url, () => expect(() => assertSafeOutboundUrl(url)).toThrow(/IPv4/));
    }
  });

  describe('blocks numeric-encoded private IPs', () => {
    // 127.0.0.1
    it('decimal 2130706433', () => expect(() => assertSafeOutboundUrl('http://2130706433/')).toThrow());
    it('hex 0x7f000001', () => expect(() => assertSafeOutboundUrl('http://0x7f000001/')).toThrow());
    it('octal 017700000001', () => expect(() => assertSafeOutboundUrl('http://017700000001/')).toThrow());
    // Dotted octal / hex bytes for 127.0.0.1
    it('dotted hex 0x7f.0.0.1', () => expect(() => assertSafeOutboundUrl('http://0x7f.0.0.1/')).toThrow());
  });

  describe('blocks IPv6 loopback / link-local / ULA', () => {
    const blocked = [
      'http://[::1]/',
      'http://[::]/',
      'http://[fe80::1]/',
      'http://[fc00::1]/',
      'http://[fd12:3456::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:10.0.0.1]/',
    ];
    for (const url of blocked) {
      it(url, () => expect(() => assertSafeOutboundUrl(url)).toThrow(/IPv6/));
    }
  });

  describe('blocks bare hostnames and LAN TLDs', () => {
    const blocked = [
      'http://router/',
      'http://homeassistant/',
      'http://localhost/',
      'http://homeassistant.local/',
      'http://nas.lan/',
      'http://thing.home.arpa/',
      'http://printer.internal/',
    ];
    for (const url of blocked) {
      it(url, () => expect(() => assertSafeOutboundUrl(url)).toThrow());
    }
  });

  describe('invalid URLs', () => {
    it('empty string', () => expect(() => assertSafeOutboundUrl('')).toThrow());
    it('garbage', () => expect(() => assertSafeOutboundUrl('not a url')).toThrow());
  });
});
