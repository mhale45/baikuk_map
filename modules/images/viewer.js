// /modules/images/viewer.js
import { client } from '../core/supabase-client.js';
import { signDisplay, signThumb, signOriginal } from './signed-url-cache.js';
import { CONFIG } from '../core/config.js';

let _imgReqToken = 0;

/* ---------- 워터마크 PNG 경로 ---------- */
export async function getWatermarkUrl() {
  const bucket = CONFIG.WM_BUCKET || CONFIG.BUCKET;
  const prefix = (CONFIG.WM_PREFIX || '').replace(/^\/+|\/+$/g, '');
  const fname  = CONFIG.WM_FILE || 'baikuk-logo-warter-mark.png';
  const path   = prefix ? `${prefix}/${fname}` : fname;

  if (CONFIG.WM_BUCKET_IS_PUBLIC !== false) {
    const { data } = client.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  } else {
    const { data } = await client.storage.from(bucket).createSignedUrl(path, 3600);
    return data?.signedUrl || '';
  }
}

/* ---------- 팝업 라이트갤러리 (워터마크 포함) ---------- */
export function openExternalViewer(items, startIndex = 0, pageTitle = '이미지 보기', listingId = '', watermarkUrl = '') {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));

  const html = `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(pageTitle)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/lightgallery/css/lightgallery.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/lightgallery/css/lg-zoom.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/lightgallery/css/lg-thumbnail.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/lightgallery/css/lg-fullscreen.css">
<style>
  body{margin:0;background:#000;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,'Noto Sans KR',sans-serif;}
  #gallery{padding:8px;}
  .lg-wm-white{
    position:fixed; inset:0; pointer-events:none; user-select:none;
    opacity:.40; background:#fff; z-index:2147483647;
    -webkit-mask-repeat:no-repeat; mask-repeat:no-repeat;
    -webkit-mask-position:center; mask-position:center;
  }
  html, body {
    -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
  }
  .lg-outer img, .lg-thumb-outer img { -webkit-user-drag: none; }
</style></head>
<body><div id="gallery"></div>
<script>
function loadScript(src){return new Promise(r=>{const s=document.createElement('script');s.src=src;s.onload=r;document.head.appendChild(s);});}
window.__ITEMS__=${JSON.stringify(items)};
window.__START__=${Number(startIndex)};
window.__WM_URL__=${JSON.stringify(watermarkUrl||'')};

const WM_RATIO_NORMAL=0.55, WM_RATIO_FS=2.2, WM_MIN=400, WM_MAX=6000;
function isFS(){return !!(document.fullscreenElement||document.webkitFullscreenElement||document.querySelector('.lg-fullscreen-on'));}
function addWM(){
  let wm=document.querySelector('.lg-wm-white');
  if(!wm){wm=document.createElement('div');wm.className='lg-wm-white';document.body.appendChild(wm);}
  if(!window.__WM_URL__){wm.style.maskImage='none';wm.style.webkitMaskImage='none';return;}
  const img=document.querySelector('.lg-current .lg-image');
  let w=img?img.getBoundingClientRect().width:window.innerWidth;
  const ratio=isFS()?WM_RATIO_FS:WM_RATIO_NORMAL;
  const targetW=Math.max(WM_MIN,Math.min(w*ratio,WM_MAX));
  wm.style.webkitMaskImage='url('+window.__WM_URL__+')';
  wm.style.maskImage='url('+window.__WM_URL__+')';
  wm.style.webkitMaskSize=targetW+'px auto';
  wm.style.maskSize=targetW+'px auto';
}
(async()=>{
  await loadScript('https://cdn.jsdelivr.net/npm/lightgallery/lightgallery.umd.js');
  await loadScript('https://cdn.jsdelivr.net/npm/lightgallery/plugins/zoom/lg-zoom.umd.js');
  await loadScript('https://cdn.jsdelivr.net/npm/lightgallery/plugins/thumbnail/lg-thumbnail.umd.js');
  await loadScript('https://cdn.jsdelivr.net/npm/lightgallery/plugins/fullscreen/lg-fullscreen.umd.js');
  const dynamicEl=(window.__ITEMS__||[]).map(it=>({src:it.display,thumb:it.thumb,subHtml:it.caption}));
  const index=Math.max(0,Math.min(window.__START__||0,Math.max(0,dynamicEl.length-1)));
  const lg=lightGallery(document.getElementById('gallery'),{dynamic:true,dynamicEl,index,plugins:[lgZoom,lgThumbnail,lgFullscreen],download:false});
  lg.openGallery(index);
  const ensure=()=>requestAnimationFrame(addWM);
  ensure();
  ['lgAfterOpen','lgAfterSlide','lgResize','lgContainerResize','lgFullscreenChange'].forEach(ev=>lg.on(ev,ensure));
  document.addEventListener('fullscreenchange',ensure); window.addEventListener('resize',ensure);
})();
<\/script></body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, `img-${listingId||'viewer'}`, 'width=1280,height=800,resizable=yes,scrollbars=yes');
  if(!w){ alert('팝업 차단을 해제해주세요'); URL.revokeObjectURL(url); return; }
  w.focus(); setTimeout(()=>URL.revokeObjectURL(url), 10000);
}

/* ---------- 상세 패널: 2장 프리뷰 + 클릭시 외부뷰어 ---------- */
export async function initImageViewerFast(listingId, listing){
  const slot = document.getElementById('image-viewer-slot');
  if (!slot || !listingId) return;
  const myToken = ++_imgReqToken;
  slot.innerHTML = '';

  // DB에서 이미지 목록
  const { data: rows, error } = await client
    .from('listing_images')
    .select('path, caption, order_index, is_primary')
    .eq('listing_id', String(listingId))
    .eq('is_private', false)
    .order('is_primary',{ ascending:false })
    .order('order_index',{ ascending:true });

  if (myToken !== _imgReqToken || error || !rows?.length) return;

  // 프리뷰 DOM
  const wrap = document.createElement('div');
  wrap.className = 'flex gap-2';
  wrap.innerHTML = `
    <div class="relative overflow-hidden w-1/2 h-[11rem] rounded bg-gray-100 thumb-box">
      <img id="iv-main-0" class="thumb-img-cover cursor-pointer no-save" />
      <div id="wm-ov-0" class="wm-white" style="display:none"></div>
    </div>
    <div class="relative overflow-hidden w-1/2 h-[11rem] rounded bg-gray-100 thumb-box">
      <img id="iv-main-1" class="thumb-img-cover cursor-pointer no-save hidden" />
      <div id="wm-ov-1" class="wm-white" style="display:none"></div>
    </div>`;
  slot.appendChild(wrap);

  const img0 = wrap.querySelector('#iv-main-0');
  const img1 = wrap.querySelector('#iv-main-1');
  const ov0  = wrap.querySelector('#wm-ov-0');
  const ov1  = wrap.querySelector('#wm-ov-1');

  // 첫 장 로드
  const first = rows[0];
  img0.src = await signDisplay(first.path, 900).catch(()=> '');
  getWatermarkUrl().then(wm=>{
    if (myToken!==_imgReqToken||!wm) return;
    ov0.style.maskImage=`url(${wm})`; ov0.style.webkitMaskImage=`url(${wm})`; ov0.style.display='block';
  });

  // 전체 아이템 준비
  const items = await Promise.all(rows.map(async (r)=>({
    display: await signDisplay(r.path,900).catch(()=> ''),
    thumb:   await signThumb(r.path,220).catch(()=> ''),
    full:    await signOriginal(r.path).catch(()=> ''),
    caption: r.caption||''
  })));

  // 두 번째 프리뷰
  if (rows[1] && items[1]?.display){
    img1.src = items[1].display;
    img1.classList.remove('hidden');
    getWatermarkUrl().then(wm=>{
      if (myToken!==_imgReqToken||!wm) return;
      ov1.style.maskImage=`url(${wm})`; ov1.style.webkitMaskImage=`url(${wm})`; ov1.style.display='block';
    });
  }

  // 클릭 시 외부 뷰어
  const title = (listing?.title || `매물 ${listingId} 이미지`);
  const wmUrl = await getWatermarkUrl().catch(()=> '');
  const openAt = i => openExternalViewer(items, i, title, String(listingId), wmUrl);
  img0.onclick=()=>openAt(0); if(!img1.classList.contains('hidden')) img1.onclick=()=>openAt(1);
}
