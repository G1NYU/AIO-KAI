import { storage } from '../storage';
import { parsePlayerTemplate, type EclipsePlayerTemplate } from './player-template';

/** Save validated Studio JSON; never execute imported markup or remote scripts. */
const KEY = 'tsugi-desktop-player-stage-v1';
export type PlayerStageId = 'default' | 'junction' | 'nocturne' | 'imported';
type StoredStage = { id: PlayerStageId; imported: unknown };
export type PlayerStageState = StoredStage & { template: EclipsePlayerTemplate | null };
const valid: readonly string[] = ['default', 'junction', 'nocturne', 'imported'];

export function readPlayerStage(): PlayerStageState {
  const value = storage.get<unknown>(KEY);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { id: 'default', imported: null, template: null };
  const entry = value as Partial<StoredStage>;
  let template: EclipsePlayerTemplate | null = null;
  try {
    if (entry.imported) template = parsePlayerTemplate(entry.imported);
  } catch {
    // Invalid imports revert to the built-in player instead of crashing startup.
  }
  const id = typeof entry.id === 'string' && valid.includes(entry.id)
    ? entry.id as PlayerStageId : 'default';
  return { id: id === 'imported' && !template ? 'default' : id,
    imported: template ? entry.imported : null, template };
}

export function savePlayerStage(id: PlayerStageId, imported: unknown): void {
  if (!valid.includes(id)) return;
  storage.set(KEY, { id, imported: imported ?? null } satisfies StoredStage);
}
