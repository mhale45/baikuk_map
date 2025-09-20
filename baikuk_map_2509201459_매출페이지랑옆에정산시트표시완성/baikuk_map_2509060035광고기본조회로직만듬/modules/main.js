import { CONFIG } from './core/config.js';
import { getSession, client } from './core/supabase-client.js';
import { getListingIdFromURL } from './core/url.js';
import { renderFilterButtons } from './ui/filters.js';
import { renderDealAndCategoryButtons } from './ui/topbar.js';
import { renderMatchedListings, showDetailPanel, hideDetailPanel } from './ui/panels.js';
import { bindListEvents } from './ui/list-renderer.js';
import { createMap, getMarkerImage, getMap } from './map/map-init.js';
import { createClusterer, setClusterMarkers } from './map/clusterer.js';
import { bindControls } from './map/controls.js';
import { state, loadListingsInBounds } from './data/listings-service.js';
import { preloadPublicStaffExtensions } from './data/staff-service.js';
import { applyPrimaryThumbsFromCache, loadPrimaryThumbsBatch } from './images/primary-thumbs.js';
import { getFilterValues } from './ui/filters.js';
import { formatDealPrice } from './core/format.js';
import { login, logout, guardAuthOrRedirect, showLogin, hideLogin, showAuthRedirectMessage } from './auth/auth-module.js';

window.app = { showDetailPanel, hideDetailPanel }; // (외부 필요하면만 노출)

async function refreshMarkersAndList(){
  const all = Object.values(state.allListings);
  const f = getFilterValues();
  const filtered = all.filter(l => {
    if (!state.selectedDealTypes.includes(l.deal_type)) return false;
    if (state.selectedCategories.length>0 && !state.selectedCategories.includes(l.category)) return false;
    for (const k in f){
      if (Number.isFinite(f[k])){
        const isMin = k.endsWith('_min');
        const col = k.replace(/_min|_max/,'');
        if (isMin && l[col] < f[k]) return false;
        if (!isMin && l[col] > f[k]) return false;
      }
    }
    return true;
  });

  state.matched = filtered; state.page = 1;
  renderMatchedListings();

  const markers = filtered.map(l =>{
    if (!state.allMarkers[l.listing_id] && l.lat && l.lng){
      state.allMarkers[l.listing_id] = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(l.lat, l.lng),
        image: getMarkerImage()
      });
      state.allMarkers[l.listing_id].listing_id = l.listing_id;
    }
    return state.allMarkers[l.listing_id];
  }).filter(Boolean);

  setClusterMarkers(markers);

  const ids = filtered.slice(0, 500).map(l=>l.listing_id);
  await loadPrimaryThumbsBatch(ids).catch(()=>{});
  await applyPrimaryThumbsFromCache(ids);
}

async function boot(){
  createMap();
  const clusterer = createClusterer(getMap());
  bindControls();

  renderDealAndCategoryButtons(state, refreshMarkersAndList);
  renderFilterButtons(refreshMarkersAndList);
  bindListEvents();

  // 세션 표시(로그아웃 버튼 등)
  const session = await getSession();
  if (session) document.getElementById('logout-btn')?.classList.remove('hidden');

  // 인증 가드(관리자 페이지일 때)
  if (CONFIG.REQUIRE_AUTH) await guardAuthOrRedirect();

  await preloadPublicStaffExtensions();

  // 최초 로딩 + 썸네일 예열
  await loadListingsInBounds(getMap());
  await refreshMarkersAndList();

  // 딥링크 처리
  const deepId = getListingIdFromURL();
  if (deepId){
    const l = state.allListings[deepId];
    if (l) showDetailPanel(deepId);
  }

  // 지도 idle 시 재로딩
  let idleTimer;
  kakao.maps.event.addListener(getMap(), 'idle', ()=>{
    clearTimeout(idleTimer);
    idleTimer = setTimeout(async ()=>{
      await loadListingsInBounds(getMap());
      await refreshMarkersAndList();
    }, 200);
  });

  // 우클릭/드래그 방지
  const protectSel = '#info-content img.no-save, #image-viewer img.no-save';
  document.addEventListener('contextmenu', e=>{ if (e.target.closest(protectSel)) e.preventDefault(); });
  document.addEventListener('dragstart',  e=>{ if (e.target.closest(protectSel)) e.preventDefault(); });

  // 로그인 모달 안내 메시지(세션 스토리지)
  showAuthRedirectMessage?.();
}

// 전역 버튼 바인딩
document.getElementById('logout-btn')?.addEventListener('click', ()=>logout());
document.querySelector('img[alt="글씨로고"]')?.addEventListener('click', ()=>showLogin());
document.getElementById('close-detail-btn')?.addEventListener('click', hideDetailPanel);


boot();
