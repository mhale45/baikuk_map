import { client } from '../core/supabase-client.js';
import { signDisplay, signThumb, signOriginal } from './signed-url-cache.js';
import { CONFIG } from '../core/config.js';

let _imgReqToken = 0;

export async function getWatermarkUrl(){
  const bucket = CONFIG.WM_BUCKET || CONFIG.BUCKET;
  const prefix = (CONFIG.WM_PREFIX||'').replace(/^\/+|\/+$/g,'');
  const fname  = CONFIG.WM_FILE;
  const path   = prefix ? `${prefix}/${fname}` : fname;

  if (CONFIG.WM_BUCKET_IS_PUBLIC !== false){
    const { data } = client.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  } else {
    const { data } = await client.storage.from(bucket).createSignedUrl(path, 3600);
    return data?.signedUrl;
  }
}

export function openExternalViewer(items, startIndex = 0, pageTitle='이미지 보기', listingId='', watermarkUrl=''){
  // (네 기존 대형 템플릿 문자열 그대로 이동)
}

export async function initImageViewerFast(listingId, listing){
  const slot = document.getElementById('image-viewer-slot');
  if (!slot || !listingId) return;

  const myToken = ++_imgReqToken;
  slot.innerHTML = '';

  const { data: rows } = await client
    .from('listing_images')
    .select('path, caption, order_index, is_primary')
    .eq('listing_id', String(listingId))
    .eq('is_private', false)
    .order('is_primary',{ ascending:false })
    .order('order_index',{ ascending:true });

  if (myToken !== _imgReqToken || !rows?.length) return;

  // (두 장 미리보기 구성 + 워터마크 오버레이 + openExternalViewer 연결 로직을 여기로 이관)
}
