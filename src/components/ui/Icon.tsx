import type { SVGProps } from 'react';

/**
 * INLINE SVG ICON SET
 *
 * Why inline SVG instead of an icon CDN:
 *  - No third-party JavaScript or CSS executes on our pages (a CDN icon font is
 *    a supply-chain and CSP liability).
 *  - `currentColor` keeps icons consistent with the design system.
 *  - Icons are decorative by default (aria-hidden) and never the sole carrier
 *    of meaning.
 *
 * Paths use a 24x24 viewBox with 1.75 stroke width for a clean, technical look.
 */

export type IconName =
  | 'home' | 'medical' | 'office' | 'hotel' | 'education' | 'event'
  | 'industry' | 'solar' | 'agriculture' | 'compute'
  | 'construction-electrical' | 'civil' | 'plumbing' | 'carpentry'
  | 'painting' | 'cleaning' | 'interior' | 'contract' | 'people'
  | 'materials' | 'bolt' | 'calendar' | 'clock' | 'phone' | 'whatsapp'
  | 'location' | 'user' | 'shield' | 'search' | 'menu' | 'close'
  | 'chevron-right' | 'chevron-left' | 'chevron-down' | 'check'
  | 'check-circle' | 'alert-circle' | 'alert-triangle' | 'info'
  | 'star' | 'star-filled' | 'truck' | 'package' | 'receipt' | 'wallet'
  | 'logout' | 'settings' | 'bell' | 'message' | 'grid' | 'list'
  | 'filter' | 'plus' | 'minus' | 'trash' | 'edit' | 'eye'
  | 'download' | 'external' | 'lock' | 'sparkle' | 'clipboard' | 'chart';

const PATHS: Record<IconName, string> = {
  home: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5M9 21v-6h6v6',
  medical: 'M4 7h16v12H4zM9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M12 11v4M10 13h4',
  office: 'M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M15 9h3a2 2 0 0 1 2 2v10M8 7h3M8 11h3M8 15h3',
  hotel: 'M3 18V6M3 12h18v6M21 18v-4M7 10h3M8 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3',
  education: 'M3 9l9-5 9 5-9 5-9-5ZM7 11v5c0 1.5 2.5 3 5 3s5-1.5 5-3v-5',
  event: 'M4 6h16v14H4zM8 3v4M16 3v4M4 10h16M9 14h2M14 14h2',
  industry: 'M3 21V10l6 4V10l6 4V7h4v14H3ZM7 18h.01M12 18h.01',
  solar: 'M3 15h18l-3 6H6l-3-6ZM6 15l1.5-6h9L18 15M10 9V6h4v3',
  agriculture: 'M12 21V11M12 11c0-3 2-6 7-6 0 4-3 6-7 6ZM12 15c0-2.5-1.7-5-6-5 0 3.3 2.5 5 6 5Z',
  compute: 'M4 5h16v11H4zM8 20h8M12 16v4M9 8h.01M12 8h.01M15 8h.01',
  'construction-electrical': 'M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6M12 8v.01',
  civil: 'M3 21h18M5 21V8l7-4 7 4v13M9 12h6M12 12v6',
  plumbing: 'M6 3v5a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v7M6 3v3M18 21h.01M4 8h4',
  carpentry: 'M4 4h16v6H4zM7 10v10M17 10v10M7 15h10',
  painting: 'M4 3h16v11H4zM7 21l4-7M4 14h16',
  cleaning: 'M9 3h6l1 5H8l1-5ZM6 8h12l-1 13H7L6 8ZM10 12v5M14 12v5',
  interior: 'M3 21V8l9-5 9 5v13M9 21v-6h6v6M7 11h2M15 11h2',
  contract: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1M17 4.5a3.5 3.5 0 0 1 0 7M18 15a5 5 0 0 1 4 5v1',
  materials: 'M3 8l9-5 9 5v8l-9 5-9-5V8ZM3 8l9 5 9-5M12 13v8',
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6l1-8Z',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.5 2',
  phone: 'M6 3h4l2 5-2.5 1.5a12 12 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2.2 2A17 17 0 0 1 4 5.2 2 2 0 0 1 6 3Z',
  whatsapp: 'M20 12a8 8 0 0 1-11.7 7.1L4 20l1-4.2A8 8 0 1 1 20 12ZM9 9c0 3 2 5 5 5l1-1.5-2-1-1 1a5 5 0 0 1-2-2l1-1-1-2-1.5.5Z',
  location: 'M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3ZM9 12l2 2 4-4',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  'chevron-right': 'M9 5l7 7-7 7',
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-down': 'M5 9l7 7 7-7',
  check: 'M5 13l4 4L19 7',
  'check-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8 12l3 3 5-6',
  'alert-circle': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 8v5M12 16h.01',
  'alert-triangle': 'M12 3 2 20h20L12 3ZM12 10v4M12 17h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01',
  star: 'M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9L12 3Z',
  'star-filled': 'M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9L12 3Z',
  truck: 'M2 6h12v10H2zM14 9h4l4 4v3h-8M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  package: 'M3 8l9-5 9 5v8l-9 5-9-5V8ZM3 8l9 5 9-5M12 13v8',
  receipt: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2V3ZM8 8h8M8 12h8M8 16h4',
  wallet: 'M3 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6ZM3 6l1-2h14M16 13h.01',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1L14.5 3h-5L9 6.1a7 7 0 0 0-1.7 1L5 6.1 3 9.5 5 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.5 3.1h5l.5-3.1a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9ZM13.7 21a2 2 0 0 1-3.4 0',
  message: 'M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  filter: 'M3 5h18l-7 8v6l-4 2v-8L3 5Z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 11v6M14 11v6',
  edit: 'M4 20h4L20 8l-4-4L4 16v4ZM14 6l4 4',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  download: 'M12 3v12M7 11l5 5 5-5M4 21h16',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  lock: 'M6 11h12v10H6zM9 11V7a3 3 0 0 1 6 0v4M12 15v2',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z',
  clipboard: 'M9 4h6v3H9zM7 5H5v16h14V5h-2M9 12h6M9 16h4',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
};

/** Icons that read better filled than stroked. */
const FILLED: IconName[] = ['star-filled'];

export type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName;
  /** Accessible label. Omit for decorative icons (defaults to aria-hidden). */
  title?: string;
  size?: number;
};

export function Icon({ name, title, size = 20, className, ...rest }: IconProps) {
  const filled = FILLED.includes(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}