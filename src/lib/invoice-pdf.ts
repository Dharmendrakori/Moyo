/**
 * INVOICE PDF RENDERING
 *
 * PURE MODULE - no database, no `server-only`, no React, no dependency. It takes
 * an already-snapshotted invoice document and returns PDF bytes, so it is unit
 * tested directly and a historical invoice is reproduced from its own stored
 * figures rather than from today's catalogue.
 *
 * WHY A HAND-WRITTEN WRITER:
 * The project has no PDF dependency and this needs one page of text and rules.
 * The bytes below are a minimal but standards-valid PDF 1.4 file using the
 * standard Type1 fonts (Helvetica / Helvetica-Bold), which every reader has.
 * Nothing is downloaded, nothing executes, and the content stream is left
 * uncompressed so the rendered figures stay auditable with a text scan.
 *
 * SAFETY:
 * - Every string is escaped for PDF string-literal syntax (`\`, `(`, `)`) so
 *   customer- or catalogue-supplied text cannot inject content-stream operators.
 *   That is the PDF equivalent of output encoding, and a test asserts it.
 * - Control characters are stripped and only printable ASCII survives: the
 *   built-in fonts use WinAnsi encoding, so anything else would render as
 *   garbage rather than as the intended character.
 * - No file paths, hostnames, database ids or internal notes are ever written.
 *
 * shortcut: text is limited to printable ASCII, so non-Latin scripts render as
 * "?". Upgrade to an embedded Unicode font (and a real PDF library) if invoices
 * must be issued in other scripts.
 */

const PAGE_WIDTH = 595.28; // A4, in points
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const RIGHT = PAGE_WIDTH - MARGIN;

/** Brand blue, from `--color-brand-700` in globals.css (#1e40af). */
const BRAND_RGB = '0.118 0.251 0.686';

export type InvoicePdfLine = {
  description: string;
  /** VISIT_CHARGE | FIXED_CHARGE | ... - rendered as a secondary line. */
  chargingLabel: string;
  quantity: number;
  unitPaise: number;
  amountPaise: number;
};

export type InvoicePdfDocument = {
  number: string;
  statusLabel: string;
  issuedAt: Date | string | null;
  bookingReference: string;
  seller: {
    name: string;
    legalName: string | null;
    address: string | null;
    email: string | null;
    phone: string | null;
    gstin: string | null;
  };
  customer: { name: string; contactName: string; contactPhone: string; address: string };
  lines: InvoicePdfLine[];
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  currency: string;
};

/**
 * Formats integer minor units for the document: `INR 1,234.00`.
 *
 * The currency CODE is used rather than the ₹ symbol on purpose: the rupee sign
 * is outside WinAnsi and would render as a missing glyph in a standard Type1
 * font. Integer arithmetic only - a paise amount is never turned into a float.
 */
export function formatMinorUnits(paise: number, currency = 'INR'): string {
  const safe = Number.isFinite(paise) ? Math.trunc(paise) : 0;
  const negative = safe < 0;
  const abs = Math.abs(safe);
  const units = Math.floor(abs / 100);
  const minor = String(abs % 100).padStart(2, '0');
  const grouped = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(units);
  return `${negative ? '-' : ''}${currency} ${grouped}.${minor}`;
}

function formatIssuedOn(issuedAt: Date | string | null): string {
  if (!issuedAt) return '';
  const date = typeof issuedAt === 'string' ? new Date(issuedAt) : issuedAt;
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * Escapes a value for a PDF string literal.
 *
 * Order matters: control characters and newlines are removed first, then the
 * three characters that terminate or escape a literal are backslash-escaped.
 * Anything outside printable ASCII becomes `?` so the standard font can draw it.
 */
export function escapePdfText(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/[^\u0020-\u007E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .slice(0, 300);
}

/** Approximate Helvetica advance width in points. Only used for alignment. */
function textWidth(value: string, size: number, bold: boolean): number {
  let units = 0;
  for (const ch of value) {
    if ("iljtfr .,:;'!|()[]-".includes(ch)) units += 278;
    else if (/[A-Z0-9]/.test(ch)) units += 620;
    else units += 500;
  }
  return (units / 1000) * size * (bold ? 1.05 : 1);
}

/** Truncates to the longest prefix that fits, ending in "...". */
function clipText(value: string, maxWidth: number, size: number, bold: boolean): string {
  let out = '';
  for (const ch of value) {
    if (textWidth(`${out}${ch}...`, size, bold) > maxWidth) break;
    out += ch;
  }
  return `${out}...`;
}

/** Word-wraps to a width in points, clipping a single over-long word. */
function wrapText(value: string, maxWidth: number, size: number, bold = false): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, size, bold) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = textWidth(word, size, bold) <= maxWidth ? word : clipText(word, maxWidth, size, bold);
  }
  if (current) lines.push(current);
  return lines;
}

const num = (value: number) => Number(value.toFixed(2));

/** One uniquely-positioned line of text. */
function textOp(
  x: number,
  y: number,
  size: number,
  bold: boolean,
  value: string,
  rgb: string,
): string {
  const escaped = escapePdfText(value);
  if (!escaped) return '';
  return `${rgb} rg BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf 1 0 0 1 ${num(x)} ${num(y)} Tm (${escaped}) Tj ET`;
}

/** Right-aligned line, so numeric columns line up. */
function rightTextOp(
  right: number,
  y: number,
  size: number,
  bold: boolean,
  value: string,
  rgb: string,
): string {
  const escaped = escapePdfText(value);
  if (!escaped) return '';
  return textOp(right - textWidth(escaped, size, bold), y, size, bold, value, rgb);
}

function rectOp(x: number, y: number, width: number, height: number, rgb: string): string {
  return `${rgb} rg ${num(x)} ${num(y)} ${num(width)} ${num(height)} re f`;
}

function ruleOp(x1: number, x2: number, y: number, rgb = '0.85 0.88 0.91'): string {
  return `${rgb} RG 0.6 w ${num(x1)} ${num(y)} m ${num(x2)} ${num(y)} l S`;
}

/** Grey caption used for block labels. */
const LABEL_RGB = '0.45 0.49 0.55';
/** Body text. */
const BODY_RGB = '0.15 0.19 0.25';
/** Muted text. */
const MUTED_RGB = '0.52 0.56 0.62';


/**
 * Builds the page content stream.
 *
 * Layout is absolute (A4 points, origin bottom-left) and deterministic: the same
 * snapshot always produces the same document, which is what makes a historical
 * invoice reproducible.
 */
function buildContent(doc: InvoicePdfDocument): string {
  const ops: string[] = [];

  // --- Brand band ----------------------------------------------------------
  ops.push(rectOp(0, PAGE_HEIGHT - 92, PAGE_WIDTH, 92, BRAND_RGB));
  ops.push(textOp(MARGIN, PAGE_HEIGHT - 44, 18, true, doc.seller.name.toUpperCase(), '1 1 1'));
  ops.push(textOp(MARGIN, PAGE_HEIGHT - 62, 8, false, 'SERVICE INVOICE', '0.85 0.90 1'));

  ops.push(rightTextOp(RIGHT, PAGE_HEIGHT - 40, 8, true, 'INVOICE', '0.85 0.90 1'));
  ops.push(rightTextOp(RIGHT, PAGE_HEIGHT - 58, 13, true, doc.number, '1 1 1'));
  const issuedOn = formatIssuedOn(doc.issuedAt);
  ops.push(
    rightTextOp(
      RIGHT,
      PAGE_HEIGHT - 74,
      8,
      false,
      [doc.statusLabel, issuedOn ? `Issued ${issuedOn}` : ''].filter(Boolean).join('  -  '),
      '0.85 0.90 1',
    ),
  );

  // --- Seller / customer ---------------------------------------------------
  const colTop = PAGE_HEIGHT - 128;
  ops.push(textOp(MARGIN, colTop, 7.5, true, 'FROM', LABEL_RGB));

  let leftY = colTop - 15;
  ops.push(textOp(MARGIN, leftY, 10.5, true, doc.seller.name, BODY_RGB));
  leftY -= 13;
  const sellerLines = [
    doc.seller.legalName && doc.seller.legalName !== doc.seller.name ? doc.seller.legalName : '',
    ...wrapText(doc.seller.address ?? '', 210, 8.5).slice(0, 3),
    doc.seller.email ?? '',
    doc.seller.phone ?? '',
    doc.seller.gstin ? `GSTIN ${doc.seller.gstin}` : '',
  ].filter(Boolean);

  for (const line of sellerLines.slice(0, 6)) {
    ops.push(textOp(MARGIN, leftY, 8.5, false, line, MUTED_RGB));
    leftY -= 11.5;
  }

  const billX = 320;
  ops.push(textOp(billX, colTop, 7.5, true, 'BILL TO', LABEL_RGB));

  let rightY = colTop - 15;
  ops.push(textOp(billX, rightY, 10.5, true, doc.customer.name, BODY_RGB));
  rightY -= 13;
  const customerLines = [
    doc.customer.contactName && doc.customer.contactName !== doc.customer.name
      ? doc.customer.contactName
      : '',
    doc.customer.contactPhone ?? '',
    ...wrapText(doc.customer.address ?? '', 215, 8.5).slice(0, 3),
  ].filter(Boolean);

  for (const line of customerLines.slice(0, 5)) {
    ops.push(textOp(billX, rightY, 8.5, false, line, MUTED_RGB));
    rightY -= 11.5;
  }

  // --- Booking reference ---------------------------------------------------
  const refY = Math.min(leftY, rightY) - 6;
  ops.push(textOp(MARGIN, refY, 7.5, true, 'BOOKING REFERENCE', LABEL_RGB));
  ops.push(textOp(MARGIN + 104, refY, 9, true, doc.bookingReference, BODY_RGB));

  // --- Line items ----------------------------------------------------------
  const tableTop = 560;
  const tableWidth = PAGE_WIDTH - MARGIN * 2;
  ops.push(rectOp(MARGIN, tableTop, tableWidth, 20, '0.96 0.97 0.99'));
  ops.push(textOp(MARGIN + 8, tableTop + 6, 7.5, true, 'DESCRIPTION', LABEL_RGB));
  ops.push(rightTextOp(332, tableTop + 6, 7.5, true, 'QTY', LABEL_RGB));
  ops.push(rightTextOp(446, tableTop + 6, 7.5, true, 'UNIT PRICE', LABEL_RGB));
  ops.push(rightTextOp(RIGHT - 8, tableTop + 6, 7.5, true, 'AMOUNT', LABEL_RGB));

  let rowY = tableTop - 4;
  // Everything below this line belongs to the totals block and the footer.
  const rowFloor = 240;
  let rendered = 0;

  for (const line of doc.lines) {
    const description = wrapText(line.description, 250, 9.5, true).slice(0, 2);
    const rowHeight = 14 + description.length * 11;
    if (rowY - rowHeight < rowFloor) break;

    const baseline = rowY - 14;
    description.forEach((text, index) => {
      ops.push(textOp(MARGIN + 8, baseline - index * 11, 9.5, true, text, BODY_RGB));
    });

    const meta = [line.chargingLabel, `Qty ${line.quantity}`].filter(Boolean).join('  -  ');
    ops.push(textOp(MARGIN + 8, baseline - description.length * 11, 8, false, meta, MUTED_RGB));

    ops.push(rightTextOp(332, baseline, 9, false, String(line.quantity), BODY_RGB));
    ops.push(
      rightTextOp(446, baseline, 9, false, formatMinorUnits(line.unitPaise, doc.currency), BODY_RGB),
    );
    ops.push(
      rightTextOp(
        RIGHT - 8,
        baseline,
        9,
        true,
        formatMinorUnits(line.amountPaise, doc.currency),
        BODY_RGB,
      ),
    );

    rowY = baseline - description.length * 11 - 12;
    ops.push(ruleOp(MARGIN, RIGHT, rowY));
    rowY -= 4;
    rendered += 1;
  }

  if (rendered < doc.lines.length) {
    ops.push(
      textOp(
        MARGIN + 8,
        rowY - 10,
        7.5,
        false,
        `${doc.lines.length - rendered} further line(s) are recorded on the invoice but not shown here.`,
        MUTED_RGB,
      ),
    );
    rowY -= 20;
  }

  // --- Totals --------------------------------------------------------------
  let totalY = Math.min(rowY - 8, rowFloor);
  const labelX = 352;

  ops.push(ruleOp(labelX, RIGHT - 8, totalY));
  totalY -= 16;
  ops.push(textOp(labelX, totalY, 9, false, 'Subtotal', MUTED_RGB));
  ops.push(
    rightTextOp(RIGHT - 8, totalY, 9, false, formatMinorUnits(doc.subtotalPaise, doc.currency), BODY_RGB),
  );

  // A tax line is only drawn when a tax amount exists. None is ever calculated
  // today (no configured tax rule), so the line is absent rather than zero-filled
  // - there is nothing to imply.
  if (doc.taxPaise > 0) {
    totalY -= 14;
    ops.push(textOp(labelX, totalY, 9, false, 'Tax', MUTED_RGB));
    ops.push(
      rightTextOp(RIGHT - 8, totalY, 9, false, formatMinorUnits(doc.taxPaise, doc.currency), BODY_RGB),
    );
  }

  totalY -= 8;
  ops.push(ruleOp(labelX, RIGHT - 8, totalY));
  totalY -= 20;
  ops.push(textOp(labelX, totalY, 11, true, 'TOTAL', BODY_RGB));
  ops.push(
    rightTextOp(RIGHT - 8, totalY, 11, true, formatMinorUnits(doc.totalPaise, doc.currency), BODY_RGB),
  );
  totalY -= 12;
  ops.push(rightTextOp(RIGHT - 8, totalY, 7.5, false, `All amounts in ${doc.currency}`, MUTED_RGB));

  // --- Footer --------------------------------------------------------------
  ops.push(ruleOp(MARGIN, RIGHT, 104));
  const footer = [
    `Computer-generated invoice for booking ${doc.bookingReference}. No signature is required.`,
    'No tax has been applied to this invoice.',
    doc.seller.gstin
      ? `GSTIN ${doc.seller.gstin}`
      : 'No tax registration is configured for this seller.',
    [doc.seller.name, doc.seller.email, doc.seller.phone].filter(Boolean).join('  -  '),
  ].filter(Boolean);

  let footY = 90;
  for (const line of footer) {
    ops.push(textOp(MARGIN, footY, 7.5, false, line, MUTED_RGB));
    footY -= 10.5;
  }

  return ops.filter(Boolean).join('\n');
}

/**
 * Renders the document as PDF bytes.
 *
 * A real cross-reference table is emitted with byte offsets; readers reject a
 * file whose `startxref` disagrees with the actual object positions.
 */
export function renderInvoicePdf(doc: InvoicePdfDocument): Uint8Array {
  const content = buildContent(doc);
  const contentBytes = Buffer.byteLength(content, 'latin1');

  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE_WIDTH)} ${num(PAGE_HEIGHT)}] ` +
      '/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${contentBytes} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  bodies.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const startXref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

