import { Trans } from '@lingui/react/macro';
import { appBridge } from '@/lib/hosts/shell/bridge';
import { BrushDisc, BrushFolder, BrushDownload } from '@/components/tsugi-icons';
import { TorBoxPanel } from './torbox-panel';

/** Provider management does not enqueue jobs or change the active resolver. */
export function VaultProviders({engineAvailable,onOpenCloud}:{engineAvailable?:boolean;onOpenCloud:()=>void}) {
  const bridge=appBridge();
  return <section data-ui="tsugi-vault-providers" className="tsugi-vault-providers">
    <TorBoxPanel manageOnly onOpenCloud={onOpenCloud}/>
    <section className="tsugi-vault-service-list">
      <h3><Trans>Built-in providers</Trans></h3>
      <div className="tsugi-vault-service"><BrushFolder aria-hidden/><div><strong><Trans>Direct files</Trans></strong><small><Trans>Books and audio · HTTPS</Trans></small></div><span data-ready={bridge?.platform==='windows'}>{bridge?.platform==='windows'?<Trans>Desktop queue available</Trans>:<Trans>Unavailable</Trans>}</span></div>
      <div className="tsugi-vault-service"><BrushDisc aria-hidden/><div><strong><Trans>YouTube Music</Trans></strong><small><Trans>Track exports</Trans></small></div><span data-ready={bridge?.youtubeMusic===true}>{bridge?.youtubeMusic===true?<Trans>Desktop resolver advertised</Trans>:<Trans>Resolver not advertised</Trans>}</span></div>
      {engineAvailable!==undefined&&<div className="tsugi-vault-service"><BrushDownload aria-hidden/><div><strong><Trans>Aria2 Next</Trans></strong><small><Trans>Automatic transfer engine</Trans></small></div><span data-ready={engineAvailable}>{engineAvailable?<Trans>Managed engine ready</Trans>:<Trans>Built-in fallback active</Trans>}</span></div>}
    </section>
  </section>;
}
