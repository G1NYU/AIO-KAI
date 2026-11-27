import React from 'react';
import { UpNext } from './up-next';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { FiArrowRight, FiCheck, FiClock, FiHome, FiPlay, FiSettings } from 'react-icons/fi';
import { TsugiBrand, TsugiMediaIcon } from '@/components/tsugi-brand';
import { isStartupArea, readStartupArea, saveStartupArea, useDesktopArea } from '@/lib/desktop-area';
import { storage } from '@/lib/storage';
import { completeIntroduction, FirstBootAppearance, hasCompletedIntroduction } from './first-boot-appearance';
import './worlds.css';
import { TsugiRail } from '@/components/shell/tsugi-rail';

type World = 'video' | 'music' | 'read' | 'vault';
type Preferences = { name: string; favorites: World[]; stillArtwork: boolean };
const key = 'tsugi-home-personalization-v1';
const ids: World[] = ['video', 'music', 'read', 'vault'];
const art: Record<World, { image: string; character: string }> = {
  video: { image: '/design/shared/hero-neon.webp', character: '映' },
  music: { image: '/design/oto/hero-yuna.webp', character: '音' },
  read: { image: '/design/yomi/hero-torii.webp', character: '読' },
  vault: { image: '/design/kura/hero-kura.webp', character: '蔵' },
};
function readPreferences(): Preferences {
  const saved = storage.get<Partial<Preferences>>(key);
  const favorites = saved?.favorites;
  return { name: typeof saved?.name === 'string' ? saved.name.slice(0, 28) : '',
    favorites: Array.isArray(favorites) ? ids.filter(id => favorites.includes(id)) : [...ids],
    stillArtwork: saved?.stillArtwork === true };
}

/** Distinct first launch, optional personalization, and returning home. */
export function DesktopLandingPage({ openVideo, openWatch, openMusic, openRead, openVault }: {
  openVideo(): void; openWatch?: (profileId?: number) => void; openMusic(): void; openRead?: () => void; openVault?: () => void;
}) {
  const desktopArea = useDesktopArea();
  const [upNextOpen, setUpNextOpen] = React.useState(false);
  const [introRevisit, setIntroRevisit] = React.useState(0);
  const [introProfile, setIntroProfile] = React.useState<number>();
  const [welcome, setWelcome] = React.useState(() => !!openVault && !hasCompletedIntroduction());
  const [preferences, setPreferences] = React.useState(readPreferences);
  const [startup, setStartup] = React.useState(readStartupArea);
  const sections = [
    { id: 'video' as const, label: t({ id: 'Movies & TV', message: 'Movies & TV' }), detail: t`Movies, television and anime`, open: () => openWatch ? openWatch(introProfile) : openVideo() },
    { id: 'music' as const, label: t({ id: 'Music', message: 'Music' }), detail: t`Music and audio`, open: openMusic },
    ...(openRead ? [{ id: 'read' as const, label: t({ id: 'Read', message: 'Read' }), detail: t`Manga, ebooks and PDFs`, open: openRead }] : []),
    ...(openVault ? [{ id: 'vault' as const, label: t({ id: 'Vault', message: 'Vault' }), detail: t`Downloads, files and collections`, open: openVault }] : []),
  ];
  const worlds = welcome ? sections : [...sections].sort((a, b) => Number(preferences.favorites.includes(b.id)) - Number(preferences.favorites.includes(a.id)));
  const displayName = preferences.name.trim();
  const personalize = () => { setStartup(readStartupArea()); setIntroRevisit(value => value + 1); };
  const explore = () => { completeIntroduction(); setWelcome(false); };
  const enter = (open: () => void) => { if (welcome) explore(); open(); };
  function update(next: Preferences) { setPreferences(next); storage.set(key, next); }
  const personalization = <section className="tsugi-world-personalization" aria-label={t`Personalize your home`}>
    <label htmlFor="tsugi-home-name"><Trans>What should we call you?</Trans> <small><Trans>Optional</Trans></small></label>
    <input id="tsugi-home-name" className="tsugi-read-input" value={preferences.name} maxLength={28} placeholder={t`Your name`} onChange={event => update({ ...preferences, name: event.target.value })}/>
    <strong><Trans>What would you like to see first?</Trans></strong>
    <div className="tsugi-world-choices">{sections.map(({ id, label }) => {
      const selected = preferences.favorites.includes(id);
      return <button key={id} type="button" aria-label={label} aria-pressed={selected} onClick={() => update({ ...preferences, favorites: selected ? preferences.favorites.filter(value => value !== id) : [...preferences.favorites, id] })}>
        <TsugiMediaIcon area={id}/><span>{label}</span>{selected && <FiCheck aria-hidden/>}
      </button>;
    })}</div>
    <p><Trans>Favorites appear first in your home. Every available world stays accessible.</Trans></p>
    <label htmlFor="tsugi-home-start"><Trans>Start each visit in</Trans></label>
    <select id="tsugi-home-start" className="tsugi-read-input" value={startup} onChange={event => {
      const value = event.target.value;
      if (isStartupArea(value)) { saveStartupArea(value); setStartup(value); }
    }}>
      <option value="auto"><Trans>Automatic</Trans></option><option value="welcome"><Trans>Home hub</Trans></option>
      {sections.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
    </select>
    <label className="tsugi-world-motion"><input type="checkbox" checked={preferences.stillArtwork} onChange={event => update({ ...preferences, stillArtwork: event.target.checked })}/><Trans>Keep welcome artwork still</Trans></label>
    <p><Trans>Your streaming connections are required before entering Tsugi. Other services can be configured whenever you are ready.</Trans></p>
  </section>;
  return <main data-page="desktop-landing" data-view={welcome ? 'welcome' : 'home'} data-motion={preferences.stillArtwork ? 'still' : undefined} className="tsugi-landing tsugi-worlds">
    {openVault && <FirstBootAppearance manual revisit={introRevisit} onProfileSelected={setIntroProfile} onFinished={() => setWelcome(false)} appearanceExtra={personalization} stillArtwork={preferences.stillArtwork}/>}
    {desktopArea?.openResume && <UpNext open={upNextOpen} onClose={() => setUpNextOpen(false)}/>}
    {!welcome && <TsugiRail area="home" className="tsugi-world-shared-rail"><nav className="tsugi-rail-local" aria-label={t`Home navigation`}>
      <button type="button" aria-current="page" aria-label={t`Home`} title={t`Home`}><FiHome aria-hidden/></button>
      {desktopArea?.openResume&&<button type="button" title={t`Up next`} aria-label={t`Up next`} onClick={()=>setUpNextOpen(true)}><FiClock aria-hidden/></button>}
    </nav></TsugiRail>}
    <div className="tsugi-world-content">
      <header className="tsugi-world-topbar">
        {welcome ? <div className="tsugi-world-brand"><TsugiBrand/><small><Trans>One home. Many worlds.</Trans></small></div> : <span className="tsugi-world-breadcrumb"><Trans>Your space</Trans> / <strong><Trans>Home</Trans></strong></span>}
        <div className="tsugi-world-toolbar">
          {openVault && <button type="button" onClick={personalize}><FiPlay aria-hidden/><Trans id="Introduction">Introduction</Trans></button>}
          {desktopArea?.openResume && <button type="button" onClick={() => setUpNextOpen(true)}><FiClock aria-hidden/><Trans>Up next</Trans></button>}
          {desktopArea && <button type="button" onClick={desktopArea.openSettings}><FiSettings aria-hidden/><Trans id="App settings">App settings</Trans></button>}
        </div>
      </header>
      {!welcome && <div className="tsugi-world-greeting"><h1>{displayName ? <Trans>Welcome, {displayName}.</Trans> : <Trans>Welcome to Tsugi.</Trans>}</h1><span><Trans>Make yourself at home.</Trans></span></div>}
      <section className="tsugi-world-hero" data-ui="tsugi-world-hero">
        <img src={welcome ? '/design/launch/welcome-city.webp' : '/design/shared/hero-train.webp'} alt="" decoding="async"/>
        <div className="tsugi-world-hero-copy">
          {welcome&&<><span className="tsugi-world-eyebrow"><Trans>Welcome to your next world</Trans></span>
          <h1><Trans>Your next world starts here.</Trans></h1>
          <p><Trans>Films to fall into. Pages to turn. Sounds to keep. Everything you love, with a little more room to get lost.</Trans></p></>}
          {openVault && <div className="tsugi-world-actions"><button type="button" className="tsugi-world-primary" onClick={personalize}><Trans>Make it yours</Trans><FiArrowRight aria-hidden/></button>{welcome && <button type="button" className="tsugi-world-secondary" onClick={explore}><Trans>Explore first</Trans></button>}</div>}
        </div>
        {welcome&&<span className="tsugi-world-hero-japanese" lang="ja" aria-hidden="true">好きな世界へ。</span>}
      </section>
      <div className="tsugi-world-heading"><div>{welcome&&<span className="tsugi-world-eyebrow"><Trans>One home. Many ways in.</Trans></span>}<h2>{welcome ? <Trans>Where will you get lost?</Trans> : <Trans>Where will you go first?</Trans>}</h2></div><p><Trans>Every world is already open to you.</Trans></p></div>
      <nav className="tsugi-world-grid" aria-label={t({ id: 'Media sections', message: 'Media sections' })}>
        {worlds.map(({ id, label, detail, open }) => <button key={id} type="button" className="tsugi-world-card" data-world={id} aria-label={label} onClick={() => enter(open)}>
          {welcome?<img src={art[id].image} alt="" decoding="async"/>:<span className="tsugi-world-minimal-art" aria-hidden="true"><TsugiMediaIcon area={id}/></span>}
          <span className="tsugi-world-card-top"><TsugiMediaIcon area={id}/><span lang="ja" aria-hidden="true">{art[id].character}</span></span>
          <span className="tsugi-world-card-copy"><span className="tsugi-world-card-title">{label}<FiArrowRight aria-hidden/></span><span className="tsugi-world-detail">{detail}</span></span>
        </button>)}
      </nav>
      {!welcome && openVault && <section className="tsugi-world-discovery"><div><span className="tsugi-world-eyebrow"><Trans>Your next discovery</Trans></span><h2><Trans>Bring your library together.</Trans></h2><p><Trans>Collect files, links and downloads in the Vault, or pick up a story where you left off.</Trans></p></div><div className="tsugi-world-actions"><button type="button" className="tsugi-world-primary" onClick={() => enter(openVault)}><Trans>Manage downloads</Trans><FiArrowRight aria-hidden/></button>{desktopArea?.openResume && <button type="button" className="tsugi-world-quiet" onClick={() => setUpNextOpen(true)}><Trans>Continue your journey</Trans></button>}</div></section>}
      {welcome&&<footer className="tsugi-world-footer"><span lang="ja">物語は、ここから。</span><span><Trans>Your stories. Your sounds. Your little universe.</Trans></span></footer>}
    </div>
  </main>;
}
