import { RESERVED_SUBDOMAINS } from './reserved-subdomains';

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;
const PURE_NUMERIC_PATTERN = /^\d+$/;

export function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function isValidSlug(slug: string): boolean {
  return (
    slug.length >= 3 &&
    slug.length <= 32 &&
    SLUG_PATTERN.test(slug) &&
    !PURE_NUMERIC_PATTERN.test(slug)
  );
}

export function isReservedSubdomain(slug: string): boolean {
  return RESERVED_SUBDOMAINS.has(normalizeSlug(slug));
}
