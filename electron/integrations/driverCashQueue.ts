/** A page cursor is scoped to one drain, independent of the durable ACK cursor.
 * Pending older operations remain eligible on the next drain, without starving
 * later roots in the current one. */
export function validateCashPage(value:unknown,after:number,through?:number) {
  const page=value as {protocol_version:number;items:unknown[];through:number;next_page_after:number;has_more:boolean};
  if(!page || page.protocol_version!==3 || !Array.isArray(page.items) || page.items.length>50 ||
    !Number.isSafeInteger(page.through) || page.through<after || through!==undefined && page.through!==through ||
    !Number.isSafeInteger(page.next_page_after) || page.next_page_after<after || page.next_page_after>page.through ||
    typeof page.has_more!=='boolean' || page.has_more && (!page.items.length || page.next_page_after===after))
    throw Error('Lista încasărilor este invalidă.');
  let last=after;
  for(const item of page.items) {
    const sequence=(item as any)?.sequence_id;
    if(!Number.isSafeInteger(sequence) || sequence<=last || sequence>page.through) throw Error('Secvența paginii este invalidă.');
    last=sequence;
  }
  if(last!==page.next_page_after) throw Error('Cursorul paginii este invalid.');
  return page;
}
export function cashRetryDelay(attempts:number) { return Math.min(300_000,5_000*2**Math.min(Math.max(attempts-1,0),6)); }
let processing=false;
let priorityUntil=0;
export function setDriverCashPriority(active:boolean) { processing=active;if(active)priorityUntil=Date.now()+60_000; }
/** Yield document work in bounded windows, never indefinitely starve it. */
export function driverCashHasPriority() { return processing && Date.now()<priorityUntil; }
