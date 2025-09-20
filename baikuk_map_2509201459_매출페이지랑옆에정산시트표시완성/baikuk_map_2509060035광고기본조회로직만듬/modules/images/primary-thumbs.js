import { client } from '../core/supabase-client.js';
import { signThumb } from './signed-url-cache.js';

const firstByListing = new Map();
const thumbCache = new Map();
const SKEW = 15000, TTL_THUMB = 600;

export async function loadPrimaryThumbsBatch(ids){
  const missing = ids.filter(id => !firstByListing.has(String(id)));
  if (missing.length){
    const { data, error } = await client
      .from('listing_images')
      .select('listing_id, path, is_primary, order_index')
      .in('listing_id', missing.map(String))
      .eq('is_private', false)
      .order('is_primary',{ ascending:false })
      .order('order_index',{ ascending:true });
    if (!error) {
      for (const r of (data||[])){
        const k = String(r.listing_id);
        if (!firstByListing.has(k)) firstByListing.set(k, r);
      }
    }
  }
  for (const id of ids){
    const k = String(id);
    const row = firstByListing.get(k);
    const c = thumbCache.get(k);
    if (!row?.path || (c && c.expireAt - Date.now() > SKEW)) continue;
    const url = await signThumb(row.path, 240).catch(()=> '');
    thumbCache.set(k, { url, expireAt: Date.now() + TTL_THUMB*1000 });
  }
}

export async function applyPrimaryThumbsFromCache(ids){
  for (const id of ids){
    const el = document.getElementById(`thumb-${id}`);
    if (!el) continue;
    const c = thumbCache.get(String(id));
    if (c?.url && el.src !== c.url) el.src = c.url;
  }
}
