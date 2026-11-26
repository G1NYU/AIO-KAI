import React from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { checkTsugiRelease,supportsTsugiReleaseCheck,tsugiReleasePage,type TsugiRelease } from '@/lib/hosts/shell/tsugi-release';

export function TsugiReleaseSettings(){
  const [busy,setBusy]=React.useState(false);
  const [release,setRelease]=React.useState<TsugiRelease|null>(null);
  const [error,setError]=React.useState(false);
  if(!supportsTsugiReleaseCheck())return null;
  async function check(){
    setBusy(true);setError(false);setRelease(null);
    try{setRelease(await checkTsugiRelease());}
    catch{setError(true);}
    finally{setBusy(false);}
  }
  return <section className="tsugi-app-general" aria-label={t`Tsugi updates`}>
    <h3><Trans>Tsugi updates</Trans></h3>
    <p><Trans>Check the official Tsugi Windows x64 stable release. This check reads release metadata only and never downloads or replaces program files.</Trans></p>
    <button className="tsugi-read-action" type="button" disabled={busy} onClick={()=>void check()}><Trans>Check stable release</Trans></button>
    {busy&&<p role="status"><Trans>Checking Tsugi releases…</Trans></p>}
    {error&&<p role="alert"><Trans>Could not verify the official release information. No update was installed.</Trans></p>}
    {release&&<div className="space-y-3">
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt><Trans>Latest stable release</Trans></dt><dd>{release.latestTag}</dd>
        <dt><Trans>Current source revision</Trans></dt><dd className="break-all">{release.currentCommit??t`Unknown`}</dd>
        <dt><Trans>Stable source revision</Trans></dt><dd className="break-all">{release.latestCommit}</dd>
        <dt><Trans>Windows package size</Trans></dt><dd>{(release.packageBytes/1048576).toFixed(1)} MiB</dd>
      </dl>
      <p role="status">{release.status==='same-build'?t`This build matches the latest stable release.`:release.status==='different-build'?t`This build differs from the stable release. It may be newer, older or a development build; do not assume an upgrade is available.`:t`Current build identity is unknown. Compare the release manually before replacing files.`}</p>
      <p className="break-all text-xs"><Trans>Published package SHA-256</Trans>: {release.sha256}</p>
      <details><summary><Trans>Release notes</Trans></summary><p className="whitespace-pre-wrap break-words max-h-60 overflow-auto">{release.notes||t`No release notes provided.`}</p></details>
      <p><Trans>The published digest has not been checked against a downloaded file. Back up your data and review manual upgrade instructions before changing installations.</Trans></p>
      <a className="tsugi-read-action inline-flex" href={tsugiReleasePage(release)} target="_blank" rel="noopener noreferrer"><Trans>Open official release</Trans></a>
    </div>}
  </section>;
}
