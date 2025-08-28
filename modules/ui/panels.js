// /modules/ui/panels.js
import { CONFIG } from '../core/config.js';
import { escapeHtml } from '../core/dom.js';
import { formatDealPrice, formatFloor } from '../core/format.js';
import { updateURLForListing } from '../core/url.js';
import { initImageViewerFast } from '../images/viewer.js';
import { applyPrimaryThumbsFromCache, loadPrimaryThumbsBatch } from '../images/primary-thumbs.js';
import { state } from '../data/listings-service.js';

/** 내부 유틸: 활성 리스트 아이템 하이라이트 */
function highlightActive(listingId) {
  const root = document.getElementById('info-content');
  if (!root) return;
  root.querySelectorAll('[data-listing-id]').forEach(el => {
    const isActive = String(el.dataset.listingId) === String(listingId || '');
    el.classList.toggle('bg-gray-100', isActive);
  });
}

/** 매칭된 목록 렌더 */
export function renderMatchedListings() {
  const end = state.page * (CONFIG?.UI?.PAGE_SIZE || 15);
  const list = (state.matched || []).slice(0, end);
  const infoContent = document.getElementById('info-content');
  if (!infoContent) return;

  infoContent.innerHTML = list.map(l => {
    const id = l.listing_id;
    const price = `${l.deal_type} ${formatDealPrice(l)}`;
    const area = Number(l.area_py ?? 0);
    const logo = 'https://sfinbtiqlfnaaarziixu.supabase.co/storage/v1/object/public/baikuk-images-open/baikuk-simbol.png';

    return `
      <div class="listing-item mb-1 pb-1 border-b border-gray-300 text-left"
           data-listing-id="${id}" role="button" tabindex="0" aria-label="매물 ${id} 상세 보기">
        <div class="cursor-pointer hover:bg-gray-100 transition p-2" data-action="open-detail">
          <div class="flex flex-row items-center gap-3">
            <div class="relative w-[150px] h-[120px] flex-shrink-0 thumb-box overflow-hidden rounded border">
              <div class="absolute top-1 left-1 w-[53px] h-[22px] flex items-center justify-center text-[15px] px-1 rounded-md font-semibold z-10"
                   style="background-color:#F2C130;color:#37373d;">
                ${id}
              </div>
              <img id="thumb-${id}" src="${logo}" alt="썸네일"
                   class="thumb-img-contain rounded no-save" draggable="false" oncontextmenu="return false" />
            </div>
            <div class="flex-1 flex flex-col gap-1">
              <div class="font-bold text-[rgb(80,152,233)] text-base">${price}</div>
              <div class="text-sm">
                전용 <strong class="font-semibold">${area.toFixed(1)}</strong>평,
                <strong class="font-semibold">${formatFloor(l.floor, l.total_floors)}</strong>
              </div>
              <div class="mt-1">
                <span class="inline-block text-[14px] text-gray-800 leading-snug">
                  ${escapeHtml(l.title || '')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }).join('');

  const ids = list.map(l => l.listing_id);
  applyPrimaryThumbsFromCache(ids);
  loadPrimaryThumbsBatch(ids).catch(() => {});
}

/** 상세 패널 열기 */
export function showDetailPanel(listingId) {
  const l = state.allListings?.[String(listingId)];
  if (!l) return;

  const detailPanel = document.getElementById('detail-panel');
  const detailContent = document.getElementById('detail-content');
  if (!detailPanel || !detailContent) return;

  // 선택 상태 보관(원하면 listings-service의 state에 필드 추가)
  state.currentDetailId = String(listingId);

  // 상세 상단 요약 + 이미지 뷰 슬롯
  detailContent.innerHTML = `
    <div class="sticky top-0 z-10 bg-white shadow-md p-2 rounded cursor-pointer whitespace-normal">
      <div class="flex items-start gap-2">
        <div class="w-[61px] h-[26px] flex justify-center items-center border-[2px] border-[rgb(242,193,48)] text-[rgb(0,0,0)] px-1 py-0 rounded text-base font-bold">
          ${l.listing_id}
        </div>
        <div class="flex-1 text-left font-semibold text-[rgb(80,152,233)] text-base translate-y-[3px] leading-tight">
          ${l.deal_type} ${formatDealPrice(l)}
          <span class="text-[13px] text-gray-700 ml-2">
            전용 <strong class="font-semibold">${Number(l.area_py ?? 0).toFixed(1)}</strong>평,
            <strong class="font-semibold">${formatFloor(l.floor, l.total_floors)}</strong>
          </span>
        </div>
      </div>
      <div class="text-base font-bold text-gray-900 mt-1">${escapeHtml(l.title || '-')}</div>
    </div>

    <div id="image-viewer-slot" class="bg-white"></div>

    <div class="px-4 pb-4">
      <table class="table-auto w-full text-sm border-t border-gray-300 mt-2">
        <tbody>
          <tr class="border-b border-gray-300">
            <td class="w-[7.5rem] py-2 font-semibold text-gray-500 bg-gray-50 border-r border-gray-300 pl-3">소재지</td>
            <td class="py-2 text-gray-800 pl-3">
              ${escapeHtml([l.province, l.city, l.district].filter(Boolean).join(' '))}
            </td>
          </tr>
          <tr class="border-b border-gray-300">
            <td class="py-2 font-semibold text-gray-500 bg-gray-50 border-r border-gray-300 pl-3">계약/전용면적</td>
            <td class="py-2 text-gray-800 pl-3 whitespace-nowrap">
              ${
                (!l.supply_area_m2 || l.supply_area_m2 === '-')
                ? `${l.area_m2 ?? ''}㎡ / ${l.area_m2 ?? ''}㎡`
                : `${l.supply_area_m2}㎡ / ${l.area_m2 ?? ''}㎡`
              }
            </td>
          </tr>
          <tr class="border-b border-gray-300">
            <td class="py-2 font-semibold text-gray-500 bg-gray-50 border-r border-gray-300 pl-3">해당층/총층</td>
            <td class="py-2 text-gray-800 pl-3">${escapeHtml(String(l.floor ?? ''))} / ${escapeHtml(String(l.total_floors ?? ''))}</td>
          </tr>
          <tr class="border-b border-gray-300">
            <td class="py-2 font-semibold text-gray-500 bg-gray-50 border-r border-gray-300 pl-3">입주가능일</td>
            <td class="py-2 text-gray-800 pl-3">즉시입주 협의가능</td>
          </tr>
          <tr class="border-b border-gray-300">
            <td class="py-2 font-semibold text-gray-500 bg-gray-50 border-r border-gray-300 pl-3">방향</td>
            <td class="py-2 text-gray-800 pl-3">${escapeHtml(l.direction ?? '')}</td>
          </tr>
          <tr class="border-b border-gray-300">
            <td class="py-2 font-semibold text-gray-500 bg-gray-50 border-r border-gray-300 pl-3">총주차대수</td>
            <td class="py-2 text-gray-800 pl-3">${escapeHtml(l.parking ?? '')}</td>
          </tr>
          <tr>
            <td class="py-2 font-semibold text-gray-500 bg-gray-50 border-r border-gray-300 pl-3">사용승인일</td>
            <td class="py-2 text-gray-800 pl-3">${escapeHtml(l.approved_date ?? '')}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div id="branch-info-slot" class="px-4 pb-6 text-xs"></div>
  `;

  detailPanel.classList.remove('hidden');
  detailPanel.scrollTop = 0;

  // URL에 반영 (뒤로가기 처리)
  updateURLForListing(listingId, true);

  // 이미지 뷰어 초기화(두 장 미리보기 + 전체뷰)
  initImageViewerFast(String(listingId), l);

  // 리스트에서도 현재 아이템 하이라이트
  highlightActive(String(listingId));
}

/** 상세 패널 닫기 */
export function hideDetailPanel() {
  const detailPanel = document.getElementById('detail-panel');
  if (detailPanel) detailPanel.classList.add('hidden');

  const slot = document.getElementById('image-viewer-slot');
  if (slot) slot.innerHTML = '';

  state.currentDetailId = null;
  updateURLForListing(null);

  // 하이라이트 해제
  highlightActive(null);
}
