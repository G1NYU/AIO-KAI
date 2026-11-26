import React from 'react';
import { FiGlobe, FiGrid } from 'react-icons/fi';
import { readImage } from '@/lib/hosts/shell/reading';

type ExtensionIconIdentity = { pkgName: string; versionName: string; versionCodeLong?: string; isInstalled: boolean };

/** Decorative installed/cached artwork only. The native adapter never fills an
 * icon cache from a provider; unavailable images retain the familiar fallback. */
export function SourceIcon({ extension, variant = 'source' }: { extension?: ExtensionIconIdentity | null; variant?: 'source' | 'extension' }) {
  const packageName = extension?.pkgName || '';
  const revision = JSON.stringify([extension?.versionName || '', extension?.versionCodeLong || '', extension?.isInstalled === true]);
  return <CachedSourceIcon key={packageName + revision} packageName={packageName} revision={revision} variant={variant} />;
}

function CachedSourceIcon({ packageName, revision, variant }: { packageName: string; revision: string; variant: 'source' | 'extension' }) {
  const element = React.useRef<HTMLSpanElement>(null);
  const [url, setUrl] = React.useState('');
  const [state, setState] = React.useState<'idle' | 'loading' | 'ready' | 'fallback'>('idle');
  React.useEffect(() => {
    const node = element.current;
    if (!node || !packageName) return;
    let visible = false, alive = true, objectUrl = '';
    let request: AbortController | undefined;
    const release = () => {
      request?.abort(); request = undefined;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = '';
    };
    const observer = new IntersectionObserver(entries => {
      const nextVisible = entries.some(entry => entry.isIntersecting);
      if (!alive || nextVisible === visible) return;
      visible = nextVisible; release(); setUrl(''); setState('idle');
      if (!visible) return;
      const controller = new AbortController(); request = controller;
      setState('loading');
      void readImage({ kind: 'extension-icon', package: packageName }, controller.signal, revision).then(image => {
        if (!alive || controller.signal.aborted || request !== controller) { URL.revokeObjectURL(image); return; }
        objectUrl = image; setUrl(image); setState('ready');
      }).catch(() => { if (alive && request === controller) setState('fallback'); });
    }, { rootMargin: '80px' });
    observer.observe(node);
    return () => { alive = false; observer.disconnect(); release(); };
  }, [packageName, revision]);
  const Icon = variant === 'extension' ? FiGrid : FiGlobe;
  return <span ref={element} aria-hidden="true" data-extension-icon={packageName || undefined} data-icon-state={packageName ? state : 'fallback'} className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded text-[--tsugi-muted]">
    {url && state === 'ready' ? <img src={url} alt="" className="h-full w-full object-contain" onError={() => setState('fallback')} /> : <Icon className="h-5 w-5" />}
  </span>;
}
