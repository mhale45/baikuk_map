// /modules/images/viewer.js
import { client } from '../core/supabase-client.js';
import { signDisplay, signThumb, signOriginal } from './signed-url-cache.js';
import { CONFIG } from '../core/config.js';

let _imgReqToken = 0;

/** 워터마크 URL */
export async function getWatermarkUrl(){
  const bucket = CONFIG.WM_BUCKET || CONFIG.BUCKET;
  const prefix = (CONFIG.WM_PREFIX||'').replace(/^\/+|\/+$/g,'');
  const fname  = CONFIG.WM_FILE || 'baikuk-logo-warter-mark.png';
  const path   = prefix ? `${prefix}/${fname}` : fname;

  if (CONFIG.WM_BUCKET_IS_PUBLIC !== false){
    const { data } = client.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  } else {
    const { data } = await client.storage.from(bucket).createSignedUrl(path, 3600);
    return data?.signedUrl || '';
  }
}

/** 전체 외부 뷰어 (네가 쓰던 큰 템플릿을 그대로 넣어 사용) */
export function openExternalViewer(items, startIndex = 0, pageTitle='이미지 보기', listingId='', watermarkUrl=''){
  // ⚠️ 여기에 "네가 원래 쓰던 대형 HTML 템플릿"을 그대로 붙여 넣으세요.
  // 아래는 안전한 기본 골격만 남겨둔 예시(요약). 실제 템플릿은 너의 기존 코드 사용 권장.
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8" />
<title>${esc(pageTitle)}</title><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial}img{max-width:100%}</style>
</head><body>
<div id="root"></div>
<script>
const ITEMS = ${JSON.stringify(items)};
let idx = ${Number(startIndex)||0};
function render(){
  const it = ITEMS[idx] || {};
  document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#000">'+
    '<img src="'+(it.display||it.full||'')+'" style="max-height:100vh;object-fit:contain" />'+
  '</div>';
}
render();
window.addEventListener('keydown', (e)=>{
  if(e.key==='ArrowRight'){ idx=Math.min(idx+1, ITEMS.length-1); render(); }
  if(e.key==='ArrowLeft'){ idx=Math.max(idx-1, 0); render(); }
});
</script></body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const w = window.open(url, `img-${listingId||'viewer'}`, 'popup=yes,width=1280,height=800,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes');
  if (!w){ alert('팝업이 차단되었습니다. 팝업을 허용해주세요.'); URL.revokeObjectURL(url); return; }
  w.focus();
  setTimeout(()=>URL.revokeObjectURL(url), 10000);
}

/**
 * 상세 패널 내 2장 프리뷰 + 오버레이 워터마크 + 외부 전체뷰 연동
 * @param {string|number} listingId
 * @param {object} [listing] - 선택(페이지 타이틀 등에 쓸 수 있음)
 */
export async function initImageViewerFast(listingId, listing){
  const slot = document.getElementById('image-viewer-slot');
  if (!slot || !listingId) return;

  const myToken = ++_imgReqToken;
  slot.innerHTML = '';

  // 1) 이미지 목록 조회
  const { data: rows, error } = await client
    .from('listing_images')
    .select('path, caption, order_index, is_primary')
    .eq('listing_id', String(listingId))
    .eq('is_private', false)
    .order('is_primary',{ ascending:false })
    .order('order_index',{ ascending:true });

  if (myToken !== _imgReqToken) return;
  if (error || !rows?.length) return;

  // 2) 프리뷰 DOM 생성(2칸)
  const wrap = document.createElement('div');
  wrap.className = 'bg-white';
  wrap.innerHTML = `
    <div class="flex gap-2">
      <div class="relative overflow-hidden w-1/2 h-[11rem] rounded bg-gray-100 thumb-box">
        <img id="image-viewer-main-0" class="thumb-img-cover cursor-pointer no-save" alt="" draggable="false" oncontextmenu="return false" />
        <div id="wm-ov-0" class="wm-white" style="display:none"></div>
      </div>
      <div class="relative overflow-hidden w-1/2 h-[11rem] rounded bg-gray-100 thumb-box">
        <img id="image-viewer-main-1" class="thumb-img-cover cursor-pointer no-save hidden" alt="" draggable="false" oncontextmenu="return false" />
        <div id="wm-ov-1" class="wm-white" style="display:none"></div>
      </div>
    </div>
  `;
  slot.appendChild(wrap);

  const img0 = wrap.querySelector('#image-viewer-main-0');
  const img1 = wrap.querySelector('#image-viewer-main-1');
  const ov0  = wrap.querySelector('#wm-ov-0');
  const ov1  = wrap.querySelector('#wm-ov-1');

  // 3) 첫 이미지 빠른 표시
  const first = rows[0];
  const firstUrl = await signDisplay(first.path, 900).catch(()=> '');
  if (myToken !== _imgReqToken) return;
  if (!firstUrl) return;

  img0.src = firstUrl;
  try { if (img0.decode) await img0.decode(); } catch {}

  // 워터마크 오버레이 (첫 장)
  getWatermarkUrl().then(wm => {
    if (myToken !== _imgReqToken) return;
    if (!wm) return;
    ov0.style.webkitMaskImage = `url('${wm}')`;
    ov0.style.maskImage = `url('${wm}')`;
    ov0.style.display = 'block';
  });

  // 4) 모든 항목 서명 URL 준비 (display/thumb/orig)
  const items = await Promise.all(rows.map(async (r) => {
    const [display, thumb, full] = await Promise.all([
      signDisplay(r.path, 900).catch(()=> ''),
      signThumb(r.path, 220).catch(()=> ''),
      signOriginal(r.path).catch(()=> ''),
    ]);
    return { display, thumb, full, caption: r.caption || '' };
  })).catch(()=> []);

  if (myToken !== _imgReqToken) return;
  if (!items.length) return;

  // 5) 두 번째 프리뷰 표시 + 워터마크
  if (rows[1] && img1) {
    const url2 = items[1]?.display || '';
    if (url2) {
      img1.classList.remove('hidden');
      img1.src = url2;
      getWatermarkUrl().then(wm => {
        if (myToken !== _imgReqToken) return;
        if (wm) {
          ov1.style.webkitMaskImage = `url('${wm}')`;
          ov1.style.maskImage = `url('${wm}')`;
          ov1.style.display = 'block';
        }
      });
    }
  }

  // 6) 클릭 시 외부 뷰어로 전체 보기
  const pageTitle = (listing?.listing_title || listing?.title || `매물 ${listingId} 이미지`).trim();
  const wmUrl = await getWatermarkUrl().catch(()=> '');
  const openAt = (i) => openExternalViewer(items, i, pageTitle, String(listingId), wmUrl);

  img0.onclick = () => openAt(0);
  if (!img1.classList.contains('hidden')) img1.onclick = () => openAt(1);
}
