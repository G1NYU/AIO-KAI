import React from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { FiBookOpen, FiColumns, FiFile, FiLayers, FiMinus, FiPlus, FiX } from 'react-icons/fi';
import { READER_DEFAULTS, type ReaderPreferences } from './reader-preferences';

type Props = { value: ReaderPreferences; onChange(value: ReaderPreferences): void; onClose?: () => void };
export function ReaderSettings({ value, onChange, onClose }: Props) {
  const [section, setSection] = React.useState<'pages' | 'look' | 'controls'>('pages');
  const change = (patch: Partial<ReaderPreferences>) => onChange({ ...value, ...patch });
  const tabs = [{ id: 'pages' as const, label: t`Pages` }, { id: 'look' as const, label: t`Appearance` }, { id: 'controls' as const, label: t`Controls` }];
  const modes = [{ id: 'scroll' as const, label: t`Scroll`, hint: t`Long strip`, Icon: FiLayers }, { id: 'single' as const, label: t`Single`, hint: t`One page`, Icon: FiFile }, { id: 'spread' as const, label: t`Spread`, hint: t`Two pages`, Icon: FiColumns }];
  const toggle = (label: string, description: string, checked: boolean, update: (next: boolean) => void, disabled = false) => <label className="tsugi-reader-setting-toggle"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => update(event.target.checked)} /></label>;
  return <div className="tsugi-reader-settings-content">
    <div className="tsugi-reader-settings-title"><FiBookOpen aria-hidden /><h3><Trans>Reader settings</Trans></h3>{onClose && <button className="tsugi-reader-icon" onClick={onClose} aria-label={t`Close settings`}><FiX /></button>}</div>
    <nav className="tsugi-read-subnav" aria-label={t`Reader settings sections`}>{tabs.map((tab) => <button key={tab.id} aria-current={section === tab.id ? 'page' : undefined} onClick={() => setSection(tab.id)}>{tab.label}</button>)}</nav>
    {section === 'pages' ? <>
      <div className="tsugi-reader-setting-group"><h4><Trans>Reading layout</Trans></h4><div className="tsugi-reader-layout-options">{modes.map(({ id, label, hint, Icon }) => <button key={id} type="button" aria-pressed={value.mode === id} onClick={() => change({ mode: id })}><Icon /><strong>{label}</strong><small>{hint}</small></button>)}</div></div>
      <div className="tsugi-reader-setting-group"><h4><Trans>Reading direction</Trans></h4><div className="tsugi-reader-choice"><button aria-pressed={!value.rtl} disabled={value.mode === 'scroll'} onClick={() => change({ rtl: false })}><Trans>Left to right</Trans></button><button aria-pressed={value.rtl} disabled={value.mode === 'scroll'} onClick={() => change({ rtl: true })}><Trans>Right to left</Trans></button></div>{value.mode === 'scroll' && <small><Trans>Scroll reads from top to bottom.</Trans></small>}</div>
      <div className="tsugi-reader-setting-group"><h4><Trans>Page size</Trans></h4><div className="tsugi-reader-choice"><button aria-pressed={value.fit === 'width' || value.mode === 'scroll'} onClick={() => change({ fit: 'width' })}><Trans>Fit width</Trans></button><button disabled={value.mode === 'scroll'} aria-pressed={value.fit === 'height' && value.mode !== 'scroll'} onClick={() => change({ fit: 'height' })}><Trans>Fit height</Trans></button><button disabled={value.mode === 'scroll'} aria-pressed={value.fit === 'original' && value.mode !== 'scroll'} onClick={() => change({ fit: 'original' })}><Trans>Original</Trans></button></div><div className="tsugi-reader-zoom"><button className="tsugi-reader-icon" aria-label={t`Zoom out`} onClick={() => change({ width: Math.max(25, value.width - 5) })}><FiMinus /></button><input type="range" min={25} max={100} step={5} value={value.width} aria-label={t`Page width`} onChange={(event) => change({ width: Number(event.target.value) })} /><button className="tsugi-reader-icon" aria-label={t`Zoom in`} onClick={() => change({ width: Math.min(100, value.width + 5) })}><FiPlus /></button><strong>{value.width}%</strong></div><button className="tsugi-reader-link" onClick={() => change({ width: READER_DEFAULTS.width })}><Trans>Reset page size</Trans></button></div>
      {toggle(t`Page spacing`, t`Leave a small gap between images.`, value.gap, (gap) => change({ gap }))}
    </> : section === 'look' ? <>
      <div className="tsugi-reader-setting-group"><h4><Trans>Reader background</Trans></h4><div className="tsugi-reader-layout-options">{([{ id: 'black', label: t`Black`, color: '#08080b' }, { id: 'graphite', label: t`Graphite`, color: '#24242c' }, { id: 'paper', label: t`Paper`, color: '#e5e2dc' }] as const).map(({ id, label, color }) => <button key={id} aria-pressed={value.background === id} onClick={() => change({ background: id })}><span className="tsugi-reader-swatch" style={{ backgroundColor: color }} />{label}</button>)}</div></div>
      {toggle(t`Focus mode`, t`Hide navigation until you move the pointer to the top or bottom, or press F.`, value.focus, (focus) => change({ focus }))}
    </> : <>
      {toggle(t`Resume reading`, t`Open a chapter at the last saved page.`, value.resume, (resume) => change({ resume }))}
      {toggle(t`Continuous reading`, t`Open the next chapter after reaching the end of a scroll chapter.`, value.autoNext, (autoNext) => change({ autoNext }))}
      {toggle(t`Ctrl + scroll to zoom`, t`Adjust page width without opening settings.`, value.wheelZoom, (wheelZoom) => change({ wheelZoom }))}
      <div className="tsugi-reader-setting-group"><h4><Trans>Keyboard shortcuts</Trans></h4><dl className="tsugi-reader-shortcuts"><dt><Trans>Page navigation</Trans></dt><dd>← / →</dd><dt><Trans>Scroll</Trans></dt><dd>↑ / ↓</dd><dt><Trans>Focus mode</Trans></dt><dd>F</dd><dt><Trans>Settings</Trans></dt><dd>S</dd><dt><Trans>Close panel or reader</Trans></dt><dd>Esc</dd></dl></div>
    </>}
    <button className="tsugi-reader-link" onClick={() => onChange(READER_DEFAULTS)}><Trans>Reset reader defaults</Trans></button>
  </div>;
}
