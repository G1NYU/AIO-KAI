import { t } from '@lingui/core/macro';
import { RestoreSessionError } from '@/lib/backup/restore-session';

export function restoreSessionFeedback(reason:unknown):string|null{
  if(!(reason instanceof RestoreSessionError))return null;
  switch(reason.code){
    case 'prepare':return t`Prepare a restore checkpoint in Data & storage before applying archived sections.`;
    case 'different':return t`A different restore session is open. Resume its saved archive, or finish its record before starting another restore.`;
    case 'busy':return t`Another restore operation is running. Wait for it to finish before retrying.`;
    case 'reader':return t`This checkpoint does not cover Reader data. Set up Reader, finish this record and prepare a new checkpoint before restoring manga.`;
    case 'active-reader':return t`Close the current book or chapter before preparing or applying a restore checkpoint.`;
    case 'invalid':return t`The saved restore record is damaged or unsupported. Review managed backups before clearing the record.`;
    case 'changed':return t`The restore record changed. Reopen the saved archive and review the section again.`;
    case 'copy':return t`A saved source or recovery copy could not be verified. Nothing was restored by this action.`;
    case 'unconfirmed':return t`Changes may have been applied, but their restore record could not be saved. Review the current state before retrying.`;
    case 'interrupted':return t`A previous restore action was interrupted or could not be confirmed. Resume the saved restore in Data & storage, then review the affected section again.`;
    case 'write':return t`The restore checkpoint could not be saved and verified. No new restore operation was started.`;
    case 'unavailable':return t`Verified restore checkpoints require managed backups and available local storage on this device.`;
  }
}
