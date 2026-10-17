import Link from 'next/link';
import { Fragment } from 'react';
import { Icon } from './Icon';

/**
 * BREADCRUMBS
 *
 * Single shared breadcrumb trail for every customer-facing catalog route
 * (categories index, category detail, service detail, search). Previously
 * each route hand-rolled the same `<nav>/ol/chevron` markup; a shared
 * component keeps the accessible structure (`aria-label`, `aria-current`)
 * identical everywhere and stops the copies drifting apart.
 *
 * `trail` is the full path from Home: pass link segments as `{label, href}`
 * and the current page as a bare `{label}` - it renders with `aria-current`
 * and no link, so the current page is never a dead self-link.
 */
export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-5">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
        {trail.map((crumb, i) => {
          const isLast = i === trail.length - 1;
          return (
            <Fragment key={`${crumb.label}-${i}`}>
              {i > 0 && (
                <li aria-hidden>
                  <Icon name="chevron-right" size={12} className="text-ink-300" />
                </li>
              )}
              <li
                className={isLast ? 'font-medium text-ink-700' : undefined}
                aria-current={isLast ? 'page' : undefined}
              >
                {crumb.href && !isLast ? (
                  <Link href={crumb.href} className="transition hover:text-brand-600">
                    {crumb.label}
                  </Link>
                ) : (
                  crumb.label
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
