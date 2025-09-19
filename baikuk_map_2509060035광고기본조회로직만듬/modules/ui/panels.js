// /modules/ui/panels.js
import { CONFIG } from '../core/config.js';
import { escapeHtml } from '../core/dom.js';
import { formatDealPrice, formatFloor } from '../core/format.js';
import { updateURLForListing } from '../core/url.js';
import { initImageViewerFast } from '../images/viewer.js';
import { applyPrimaryThumbsFromCache, loadPrimaryThumbsBatch } from '../images/primary-thumbs.js';
import { state } from '../data/listings-service.js';

/* ───────── 유틸: 표시/포맷 ───────── */

// 소수 첫째자리
function oneDecimal(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(1) : '';
}

// 만 단위 포맷(간단 버전)
function fmtMan(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('ko-KR') : String(v);
}

// ㎡ → 평
function toPyeong(m2) {
  if (m2 === null || m2 === undefined || m2 === '') return '';
  const n = Number(m2);
  if (!Number.isFinite(n)) return '';
  return Math.round(n * 0.3025 * 10) / 10;
}

// 설명문 생성 (staff 내선은 있으면 사용, 없으면 빈 문자열)
function buildListingDescBlock(listing) {
  const listingId   = listing.listing_id ?? listing.id ?? '';
  const deposit     = fmtMan(listing.deposit_price);
  const monthly     = fmtMan(listing.monthly_rent);
  const areaPy      = oneDecimal(listing.area_py ?? toPyeong(listing.area_m2));
  const loc = [
    listing.province, listing.city, listing.district,
    listing.detail_address, listing.building_name
  ].filter(Boolean).join(' ');
  const buildingUsage   = listing.building_usage ?? '';
  const restroom        = listing.restroom ?? '';
  const storeTypeDetail = listing.store_type_detail ?? '';
  const title           = listing.title ?? '';

  // 선택적 글로벌/모듈 함수 지원
  const staffExt = typeof globalThis.getExtensionFromAgentName === 'function'
    ? globalThis.getExtensionFromAgentName(listing)
    : '';

  const lines = [
    '┎  네이버에 "백억지도"를 검색하세요',
    '│  모든 매물을 확인할 수 있습니다',
    '└  www.백억지도.com',
    '',
    `🌈 백억 매물번호 :  ${listingId}`,
    '위 매물번호 알려주시면 빠르게 상담진행 가능합니다!',
    '',
    '🌈 매물 정보 요약',
    `- 금액 : 보증금 ${deposit} 만 / 월세 ${monthly}만 /  권리(전화문의)`,
    `- 면적 : 약 ${areaPy}평`,
    `- 위치 : ${loc}`,
    `- 용도 : ${buildingUsage}`,
    `- 방 : 건축물현황도상 방없음`,
    `- 화장실 : ${restroom}`,
    `- 추천업종 : ${storeTypeDetail}`,
    `- 특징 : ${title}`,
    '',
    '🌈 백억 부동산의 약속',
    '- 신속, 정확, 정직한 중개, 신뢰있는 중개, 허위 매물 ZERO',
    '- 업종과 조건(위치, 면적, 보증금, 임대료, 권리금)에 맞는 최적화 매물을 찾아 드립니다.',
    '- 고객님의 입장에서 보증금과 임대료, 권리금 최대한 조율 해 드립니다.',
    '- 고객님 한분 한분의 인연을 소중하게 생각합니다.',
    '',
    `📞 친절한 상담 ${staffExt}`
  ];

  return lines.map(escapeHtml).join('\n'); // HTML 주입 시 XSS 방지
}

/* ───────── 리스트 하이라이트 ───────── */
function highlightActive(listingId) {
  const root = document.getElementById('info-content');
  if (!root) return;
  root.querySelectorAll('[data-listing-id]').forEach(el => {
    const isActive = String(el.dataset.listingId) === String(listingId || '');
    el.classList.toggle('bg-gray-100', isActive);
  });
}

/* ───────── 목록 렌더 ───────── */
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

/* ───────── 상세 열기 ───────── */
export function showDetailPanel(listingId) {
  const l = state.allListings?.[String(listingId)];
  if (!l) return;

  const detailPanel = document.getElementById('detail-panel');
  const detailContent = document.getElementById('detail-content');
  if (!detailPanel || !detailContent) return;

  state.currentDetailId = String(listingId);

  // 상단 요약 + 이미지 뷰 슬롯 + 설명문(요청하신 블록 복원)
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

    <div class="mb-2 px-4 pt-2">
      <span class="text-base font-medium whitespace-pre-line leading-relaxed md:leading-7">
        ${buildListingDescBlock(l)}
      </span>
    </div>

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

  updateURLForListing(listingId, true);
  initImageViewerFast(String(listingId), l);
  highlightActive(String(listingId));
}

/* ───────── 상세 닫기 ───────── */
export function hideDetailPanel() {
  const detailPanel = document.getElementById('detail-panel');
  if (detailPanel) detailPanel.classList.add('hidden');

  const slot = document.getElementById('image-viewer-slot');
  if (slot) slot.innerHTML = '';

  state.currentDetailId = null;
  updateURLForListing(null);
  highlightActive(null);
}
