import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@aiostreams/ui/core/styling';

/** Shared presentation for server versions and native addon stream choices.
 * Only the caller owns source resolution and the playback action. */
export function VersionFrame({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div {...props} data-ui="version" className={cn('group/version relative flex items-start rounded-xl border border-white/5 bg-white/[0.03] transition-colors [contain-intrinsic-size:auto_7rem] [content-visibility:auto] hover:border-white/10 hover:bg-white/[0.06]', className)} />;
}
