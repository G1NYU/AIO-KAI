/** Upcoming-only edits preserve the active item's index and identity. */
export function moveUpcoming<T>(queue:T[],current:number,at:number,direction:-1|1):T[]{
  const to=at+direction;
  if(current<0||current>=queue.length||at<=current||at>=queue.length||to<=current||to>=queue.length)return queue;
  const next=queue.slice();[next[at],next[to]]=[next[to],next[at]];return next;
}
export function removeUpcoming<T>(queue:T[],current:number,at:number):T[]{
  return current>=0&&current<queue.length&&at>current&&at<queue.length?queue.filter((_,i)=>i!==at):queue;
}
export function clearUpcoming<T>(queue:T[],current:number):T[]{
  return current>=0&&current<queue.length?queue.slice(0,current+1):queue;
}
