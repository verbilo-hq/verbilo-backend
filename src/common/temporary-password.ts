import { randomInt } from 'crypto';

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const NUMBERS = '0123456789';
const SPECIAL = '!@#$%^&*()_+-=[]{}|;:,.<>?';
const ALL_CHARS = UPPERCASE + LOWERCASE + NUMBERS + SPECIAL;

function pick(chars: string): string {
  return chars[randomInt(chars.length)];
}

export function generateTemporaryPassword(length = 12): string {
  if (length < 4) {
    throw new Error('Temporary password length must be at least 4');
  }

  const chars = [
    pick(UPPERCASE),
    pick(LOWERCASE),
    pick(NUMBERS),
    pick(SPECIAL),
    ...Array.from({ length: length - 4 }, () => pick(ALL_CHARS)),
  ];

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}
