import React from 'react';
import { t } from '@lingui/core/macro';
import { MovieGlyph } from '@/components/movie-icons';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@aiostreams/ui/dropdown-menu';
import { TsugiMediaIcon } from '@/components/tsugi-brand';
import { useDesktopArea } from '@/lib/desktop-area';
import { mediaDestinations } from '../media-navigation';

/** Keep Movies' familiar sidebar intact, with the other spaces one click away. */
export function MovieMediaMenu() {
  const actions = useDesktopArea();
  if (!actions) return null;
  return (
    <DropdownMenu
      data-ui="movie-media-menu"
      side="right"
      align="end"
      sideOffset={12}
      className="min-w-52"
      trigger={
        <button
          type="button"
          data-ui="movie-media-switch"
          className="tsugi-video-media-switch"
          aria-label={t({ id: 'All media', message: 'All media' })}
        >
          <MovieGlyph name="grid" />
          <span>{t({ id: 'All media', message: 'All media' })}</span>
        </button>
      }
    >
      <DropdownMenuLabel>{t({ id: 'Media sections', message: 'Media sections' })}</DropdownMenuLabel>
      {mediaDestinations(actions).map(({ id, label, open }) => (
        <DropdownMenuItem
          key={id}
          data-name={id}
          aria-current={id === 'video' ? 'page' : undefined}
          onClick={open}
        >
          <TsugiMediaIcon area={id} />
          {label}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem data-name="all-media" onClick={actions.openWelcome}>
        <MovieGlyph name="grid" />
        {t({ id: 'All media', message: 'All media' })}
      </DropdownMenuItem>
      <DropdownMenuItem data-name="app-settings" onClick={actions.openSettings}>
        <MovieGlyph name="settings" />
        {t({ id: 'App settings', message: 'App settings' })}
      </DropdownMenuItem>
    </DropdownMenu>
  );
}
