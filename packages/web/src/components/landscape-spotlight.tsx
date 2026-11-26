import type { ReactNode } from 'react';
import { Trans } from '@lingui/react/macro';
import { LandscapeDecoration } from './landscape-decoration';

type SpotlightProps = {
  title:string;eyebrow:string;description:string;actionLabel:string;onAction:()=>void;disabled?:boolean;
  featuredKey?:string;featuredArtwork?:ReactNode;onNextFeatured?:()=>void;
  designArea?:'read'|'music'|'vault';localArtwork?:string;active?:boolean;
};

export function LandscapeSpotlight({title,eyebrow,description,actionLabel,onAction,disabled=false,featuredKey,featuredArtwork,onNextFeatured,designArea,localArtwork,active=true}:SpotlightProps) {
  return <section className={'tsugi-spotlight tsugi-landscape-spotlight'+(designArea?' tsugi-design-spotlight':'')} data-ui="landscape-spotlight" data-artwork-mode={featuredKey?'featured':'illustration'} data-design-area={designArea}>
    <LandscapeDecoration fallback={localArtwork} className="tsugi-spotlight-backdrop" active={active} />
    {featuredKey && <div className="tsugi-spotlight-source-cover">{featuredArtwork}</div>}
    <div className="tsugi-spotlight-copy">
      <p className="tsugi-feature-kicker">{eyebrow}</p><h2>{title}</h2><p>{description}</p>
      <button type="button" className="tsugi-read-action tsugi-series-primary mt-6" onClick={onAction} disabled={disabled}>{actionLabel}</button>
    </div>
    {featuredKey && onNextFeatured && <button type="button" className="tsugi-spotlight-featured-next" onClick={onNextFeatured} disabled={disabled}><Trans>Next featured title</Trans></button>}
  </section>;
}
