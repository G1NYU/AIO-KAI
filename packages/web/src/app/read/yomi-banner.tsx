import type { ReactNode } from 'react';
import { LandscapeDecoration } from '@/components/landscape-decoration';
import { BrushHeading } from '@/components/brush-heading';

/** Decorative landscapes stay separate from actual collection information. */
export function YomiBanner({ eyebrow, title, description, artwork = '/design/yomi/hero-torii.webp', children }: {
  eyebrow: string;
  title: string;
  description: string;
  artwork?: string;
  children?: ReactNode;
}) {
  return <section className="yomi-banner" data-ui="yomi-editorial-banner">
    <LandscapeDecoration className="yomi-banner-art" fallback={artwork} />
    <div className="yomi-banner-copy">
      <p className="yomi-eyebrow">{eyebrow}</p>
      <BrushHeading as="h2">{title}</BrushHeading>
      <p>{description}</p>
    </div>
    {children && <div className="yomi-banner-extra">{children}</div>}
  </section>;
}
