import { clsx, type ClassValue } from 'clsx';

/** Shared class-name joiner. Keeps conditional classes readable. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

/**
 * Formats paise to an Indian Rupee string.
 * Server-side canonical formatting; the UI must never format a price from a
 * client-supplied number - only from a server-resolved integer.
 */
export function formatINR(paise: number | null | undefined): string {
  if (paise == null) return '—';
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: rupees % 1 === 0 ? 0 : 2,
  }).format(rupees);
}

/** Compact rupee formatting for dashboard tiles: ₹1.2L, ₹3.4Cr. */
export function formatINRCompact(paise: number | null | undefined): string {
  if (paise == null) return '—';
  const rupees = paise / 100;
  if (rupees >= 10_000_000) return `₹${(rupees / 10_000_000).toFixed(2)}Cr`;
  if (rupees >= 100_000) return `₹${(rupees / 100_000).toFixed(2)}L`;
  if (rupees >= 1_000) return `₹${(rupees / 1_000).toFixed(1)}K`;
  return `₹${rupees.toFixed(0)}`;
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

/**
 * Builds a WhatsApp deep link with a pre-filled, encoded message.
 * The phone number is normalized to digits and the text is URL-encoded, so no
 * user string can inject query parameters or break out of the href.
 */
export function whatsappLink(phone: string | null | undefined, message: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message.slice(0, 500))}`;
}

/** Builds a tel: link from a phone number, digits only. */
export function telLink(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  return `tel:+${digits}`;
}

/** Truncates to a maximum length without cutting mid-word where avoidable. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd()}…`;
}

/** Initials for avatar placeholders. Never used to imply a photo exists. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}