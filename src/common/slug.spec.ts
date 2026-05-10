import { isReservedSubdomain, isValidSlug, normalizeSlug } from './slug';

describe('slug helpers', () => {
  describe('normalizeSlug', () => {
    it('lowercases, trims separators, and collapses non-alphanumeric runs', () => {
      expect(normalizeSlug('  Acme Dental Group!! London  ')).toBe(
        'acme-dental-group-london',
      );
    });

    it('collapses repeated dashes created by punctuation', () => {
      expect(normalizeSlug('North---West___Dental')).toBe('north-west-dental');
    });
  });

  describe('isValidSlug', () => {
    it('accepts 3 to 32 character slugs that start and end alphanumeric', () => {
      expect(isValidSlug('abc')).toBe(true);
      expect(isValidSlug('a-b')).toBe(true);
      expect(isValidSlug(`a${'b'.repeat(30)}c`)).toBe(true);
    });

    it('rejects slugs outside the length boundary', () => {
      expect(isValidSlug('ab')).toBe(false);
      expect(isValidSlug(`a${'b'.repeat(31)}c`)).toBe(false);
    });

    it('rejects edge dashes, invalid characters, and pure numeric slugs', () => {
      expect(isValidSlug('-abc')).toBe(false);
      expect(isValidSlug('abc-')).toBe(false);
      expect(isValidSlug('abc!')).toBe(false);
      expect(isValidSlug('123')).toBe(false);
    });
  });

  describe('isReservedSubdomain', () => {
    it('detects reserved subdomains after normalization', () => {
      expect(isReservedSubdomain('Admin')).toBe(true);
      expect(isReservedSubdomain('support')).toBe(true);
      expect(isReservedSubdomain('acme-dental')).toBe(false);
    });
  });
});
