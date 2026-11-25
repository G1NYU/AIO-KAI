import { appBridge, ask } from '@/lib/hosts/shell/bridge';
import { TorBoxError, type TorBoxItem } from './torbox';

export function supportsNativeTorBox() { return appBridge()?.torbox === true; }
type Operation = 'status' | 'connect' | 'list' | 'submit' | 'disconnect';
type Reply = { connected: boolean; items?: TorBoxItem[] };
export async function nativeTorBox(operation: Operation, value = ''): Promise<Reply> {
  if (!supportsNativeTorBox()) throw new TorBoxError('network');
  const request = crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2,'0')).join('');
  const reply = await ask({type:'torbox-request',request,operation,value},'torbox-result',{timeoutMs:85000,matches:m=>m.request===request});
  if (reply.error) throw new TorBoxError(reply.error==='auth'?'auth':reply.error==='rate'?'rate':reply.error==='network'?'network':'request');
  if (!reply.data || typeof reply.data !== 'object' || !('connected' in reply.data) || typeof reply.data.connected !== 'boolean') throw new TorBoxError('request');
  return reply.data as Reply;
}
