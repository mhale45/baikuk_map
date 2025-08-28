import { CONFIG } from '../core/config.js';
import { escapeHtml } from '../core/dom.js';
import { formatDealPrice, formatFloor } from '../core/format.js';
import { updateURLForListing } from '../core/url.js';
import { initImageViewerFast } from '../images/viewer.js';
import { applyPrimaryThumbsFromCache, loadPrimaryThumbsBatch } from '../images/primary-thumbs.js';
import { state } from '../data/listings-service.js';

export function renderMatchedListings(){
  const end = state.page * CONFIG.UI.PAGE_SIZE;
  const list = state.matched.slice(0, end);
  const infoContent = document.getElementById('info-content');

  infoContent.innerHTML = list.map(l => `
    <div class="mb-1 pb-1 border-b border-gray-300 text-left">
      <div class="cursor-pointer hover:bg-gray-100 transition p-2" data-action="open-detail" data-id="${l.listing_id}">
        <div class="flex flex-row items-center gap-3">
          <div class="relative w-[150px] h-[120px] flex-shrink-0 thumb-box overflow-hidden rounded border">
            <div class="absolute top-1 left-1 w-[53px] h-[22px] flex items-center justify-center text-[15px] px-1 rounded-md font-semibold z-10" style="background-color:#F2C130;color:#37373d;">
              ${l.listing_id}
            </div>
            <img id="thumb-${l.listing_id}" src="https://sfinbtiqlfnaaarziixu.supabase.co/storage/v1/object/public/baikuk-images-open/baikuk-simbol.png" class="thumb-img-contain rounded no-save" draggable="false" oncontextmenu="return false" />
          </div>
          <div class="flex-1 flex flex-col gap-1">
            <div class="font-bold text-[rgb(80,152,233)] text-base">${l.deal_type} ${formatDealPrice(l)}</div>
            <div class="text-sm">전용 <strong class="font-semibold">${Number(l.area_py).toFixed(1)}</strong>평, <strong class="font-semibold">${formatFloor(l.floor, l.total_floors)}</strong></div>
            <div class="mt-1"><span class="inline-block text-[14px] text-gray-800 leading-snug">${escapeHtml(l.title||'')}</span></div>
          </div>
        </div>
      </div>
    </div>`).join('');

  const ids = list.map(l => l.listing_id);
  applyPrimaryThumbsFromCache(ids);
  loadPrimaryThumbsBatch(ids).catch(()=>{});
}

export function showDetailPanel(listingId){
  const l = state.allListings[String(listingId)];
  if (!l) return;
  const detailPanel = document.getElementById('detail-panel');
  const detailContent = document.getElementById('detail-content');

  // (네가 쓰던 detailContent.innerHTML 템플릿을 이쪽으로 이동)
  // ...
  detailPanel.classList.remove('hidden');
  updateURLForListing(listingId, true);

  initImageViewerFast(listingId, l);
}

export function hideDetailPanel(){
  document.getElementById('detail-panel').classList.add('hidden');
  // 이미지 슬롯 비우기 + URL 정리
  const slot = document.getElementById('image-viewer-slot');
  if (slot) slot.innerHTML = '';
  updateURLForListing(null);
}
