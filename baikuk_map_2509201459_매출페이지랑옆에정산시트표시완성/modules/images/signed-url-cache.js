import { client } from '../core/supabase-client.js';
import { CONFIG } from '../core/config.js';

const TTL = { thumb:600, display:900, orig:900 };
const SKEW = 15000;
const cache = new Map();
const keyOf = (path, kind, w='') => `${kind}:${path}|w=${w}`;

async function issue(kind, path, w){
  if (kind==='thumb'){
    const { data, error } = await client.storage.from(CONFIG.BUCKET)
      .createSignedUrl(path, TTL.thumb, { transform:{ width:w??220, resize:'contain', quality:85 }});
    if (error) throw error; return { url:data.signedUrl, ttl:TTL.thumb };
  }
  if (kind==='display'){
    const { data, error } = await client.storage.from(CONFIG.BUCKET)
      .createSignedUrl(path, TTL.display, { transform:{ width:w??900, quality:85 }});
    if (error) throw error; return { url:data.signedUrl, ttl:TTL.display };
  }
  const { data, error } = await client.storage.from(CONFIG.BUCKET).createSignedUrl(path, TTL.orig);
  if (error) throw error; return { url:data.signedUrl, ttl:TTL.orig };
}

export async function getSignedUrl(kind, path, w){
  const k = keyOf(path, kind, w);
  const now = Date.now();
  const c = cache.get(k);
  if (c?.inflight) return c.inflight;
  if (c?.url && c?.expireAt - now > SKEW) return c.url;

  const inflight = (async () => {
    const { url, ttl } = await issue(kind, path, w);
    cache.set(k, { url, expireAt: Date.now() + ttl*1000, inflight: null });
    return url;
  })();
  cache.set(k, { ...(c||{}), inflight });
  return inflight;
}

export const signThumb    = (p,w=240)=>getSignedUrl('thumb',p,w);
export const signDisplay  = (p,w=900)=>getSignedUrl('display',p,w);
export const signOriginal = (p)=>getSignedUrl('orig',p);
