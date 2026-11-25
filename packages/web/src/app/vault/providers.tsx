import { Trans } from '@lingui/react/macro';
import { appBridge } from '@/lib/hosts/shell/bridge';
import { TorBoxPanel } from './torbox-panel';

/** Provider management does not enqueue jobs or change the active resolver. */
export function VaultProviders({engine,onEngineChange}:{engine?:{available:boolean;enabled:boolean};onEngineChange:(enabled:boolean)=>void}) {
  const bridge=appBridge();
  return <section data-ui="tsugi-vault-providers">
    <h3><Trans>Download providers</Trans></h3>
    <p><Trans>Manage local transfer sources and your optional cloud account. Downloads are started separately in Vault.</Trans></p>
    <div className="tsugi-vault-file-row">
      <div><strong><Trans>Direct files</Trans></strong><p><Trans>Public HTTPS book and audio links. No account required.</Trans></p></div>
      <span>{bridge?.platform==='windows'?<Trans>Desktop queue available</Trans>:<Trans>Unavailable</Trans>}</span>
    </div>
    <div className="tsugi-vault-file-row">
      <div><strong><Trans>YouTube Music</Trans></strong><p><Trans>Native resolver for authorized individual track exports. Provider access is checked during a transfer.</Trans></p></div>
      <span>{bridge?.youtubeMusic===true?<Trans>Desktop resolver advertised</Trans>:<Trans>Resolver not advertised</Trans>}</span>
    </div>
    {engine&&<div className="tsugi-vault-file-row">
      <div><strong><Trans>Aria2 Next (optional)</Trans></strong><p>{engine.available?<Trans>Verified external engine. Eligible direct files use segmented transfers; incompatible files use the built-in engine.</Trans>:<Trans>Install the pinned Windows x64 engine in the vault-tools folder beside Tsugi.exe, then restart Tsugi.</Trans>}</p><p><Trans>Changes apply to new or resumed transfers. The built-in downloader remains available.</Trans></p></div>
      <label><input type="checkbox" disabled={!engine.available} checked={engine.enabled} onChange={event=>onEngineChange(event.target.checked)}/><Trans>Use Aria2 Next</Trans></label>
    </div>}
    <div className="tsugi-pixel-rule" aria-hidden="true"/>
    <TorBoxPanel manageOnly/>
  </section>;
}
