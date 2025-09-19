// /modules/ui/list-renderer.js
import { state } from '../data/listings-service.js';
import { renderMatchedListings, showDetailPanel } from './panels.js';

/**
 * 인포패널 스크롤 무한 로딩 + 리스트 클릭 시 상세패널 열기 (이벤트 위임)
 */
export function bindListEvents() {
  const infoPanel = document.getElementById('info-panel');
  const infoContent = document.getElementById('info-content');
  if (!infoPanel || !infoContent) {
    console.warn('[list-renderer] info panel/content not found');
    return;
  }

  // 패널 표시
  infoPanel.classList.remove('hidden');

  // ---- 무한 스크롤
  infoPanel.addEventListener('scroll', function () {
    const nearBottom = this.scrollTop + this.clientHeight >= this.scrollHeight - 50;
    if (!nearBottom) return;

    const PAGE_SIZE = 15; // 필요하면 config로 분리
    if (state.page * PAGE_SIZE < (state.matched?.length || 0)) {
      state.page++;
      renderMatchedListings();
    }
  }, { passive: true });

  // ---- 클릭 이벤트 위임: 어떤 내부 요소를 눌러도 상세 열기
  infoContent.addEventListener('click', (e) => {
    // 클릭된 요소에서 가장 가까운 트리거 찾기
    const trigger = e.target.closest('[data-action="open-detail"], [data-listing-id], .listing-item');
    if (!trigger) return;

    // id 추출 우선순위: data-listing-id > data-id > id 속성의 숫자
    const id =
      trigger.dataset?.listingId ||
      trigger.getAttribute?.('data-id') ||
      trigger.closest?.('[data-listing-id]')?.dataset?.listingId;

    if (!id) {
      console.warn('[list-renderer] clicked item has no listing id');
      return;
    }

    showDetailPanel(String(id));
  });

  // ---- 키보드 접근성: Enter/Space로도 열기
  infoContent.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('[data-listing-id], .listing-item');
    if (!row) return;

    const id = row.dataset?.listingId || row.getAttribute?.('data-id');
    if (!id) return;

    e.preventDefault(); // 스페이스 스크롤 방지
    showDetailPanel(String(id));
  });
}
