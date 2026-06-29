import { client as supabase, waitForSupabase } from '../core/supabase.js';

const menuItems = [
  { key: 'baikuk_map', label: '백억지도', href: 'https://baikuk.com/map', target: '_self' },
  { key: 'mmap', label: '백억지도', href: '/admin/mmap/', mb5: true },
  { key: 'listings', label: '매물장부', href: '/admin/listings/' },
  { key: 'recommend_imDae', label: '임대추천', href: '/admin/recommend_imDae/' },
  { key: 'recommend_maeMae', label: '매매추천', href: '/admin/recommend_maeMae/' },
  { key: 'customer_manage', label: '모든고객', href: '/admin/customer_manage/', mb5: true },
  { key: 'ad_censorship', label: '광고검토', href: '/admin/ad_censorship/' },
  { key: 'ad_management', label: '광고관리', href: '/admin/ad_management/' },
  { key: 'staff_manage', label: '직원정보', href: '/admin/staff_manage/' }
];

// 모바일 전용 스타일 동적 삽입
function injectMobileStyles() {
  if (document.getElementById('mobile-sidebar-styles')) return;

  const style = document.createElement('style');
  style.id = 'mobile-sidebar-styles';
  style.innerHTML = `
    @media (max-width: 1024px) {
      /* 기존 sidebar-container 레이아웃 점유 제거 */
      #sidebar-container {
        display: none !important;
      }
      
      /* body 스크롤 방지 해제하여 핀치 줌 후 이동 및 전체 스크롤을 원활하게 함 */
      body {
        overflow-y: auto !important;
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch !important;
      }
      
      /* absolute 로고 및 타이틀 겹침 방지 */
      .absolute.top-0.left-0.z-\\[9998\\].bg-white.w-\\[13rem\\].h-\\[60px\\],
      div.absolute.top-0.left-0.z-\\[9998\\].bg-white {
        position: relative !important;
        width: 100% !important;
        height: auto !important;
        display: flex !important;
        align-items: center !important;
        justify-content: flex-start !important;
        padding: 0.5rem 1rem !important;
        box-sizing: border-box !important;
      }
      .absolute.top-0.left-0.z-\\[9998\\].bg-white.w-\\[13rem\\].h-\\[60px\\] img,
      div.absolute.top-0.left-0.z-\\[9998\\].bg-white img {
        position: static !important;
        height: 2.25rem !important;
        width: auto !important;
      }
      
      #page-title {
        position: relative !important;
        top: auto !important;
        left: auto !important;
        margin: 0.75rem 1rem !important;
        display: block !important;
        font-size: 1.5rem !important;
        font-weight: bold !important;
      }
      
      /* flex 컨테이너 내부의 본문 가로 퍼센트 너비를 모바일에선 auto 및 min-width로 풀어줌 */
      .flex > div.w-\\[84\\%\\],
      .flex > div.w-\\[91\\%\\],
      .flex > div.w-\\[94\\%\\],
      .flex > div.w-\\[14\\%\\],
      .flex > div.bg-gray-100.w-\\[14\\%\\] {
        width: auto !important;
        min-width: 100% !important;
        box-sizing: border-box !important;
      }
      
      /* Flex 부모가 세로로 흐르게 변경 (일부 페이지용) */
      .flex.min-h-screen {
        flex-direction: column !important;
      }
      
      /* 전체 페이지 가로 스크롤 가능하게 min-width 설정 완화 */
      .flex.min-h-screen > div {
        flex-shrink: 0 !important;
      }
    }
  `;
  document.head.appendChild(style);
}

// 모바일 전용 메뉴 버튼 및 Drawer 렌더링
function renderMobileMenu(filteredMenuItems, activeKey) {
  if (document.getElementById('mobile-sidebar-toggle-btn')) return;

  // 1. 햄버거 토글 버튼 생성
  const toggleBtn = document.createElement('div');
  toggleBtn.id = 'mobile-sidebar-toggle-btn';
  toggleBtn.className = 'fixed bottom-6 right-6 z-[99999] bg-[#F2C130] hover:bg-[#E0B120] text-black w-14 h-14 rounded-full flex items-center justify-center shadow-2xl cursor-pointer select-none transition-transform duration-200 active:scale-95 lg:hidden';
  toggleBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  `;

  // 2. Backdrop(어두운 배경) 생성
  const backdrop = document.createElement('div');
  backdrop.id = 'mobile-sidebar-backdrop';
  backdrop.className = 'fixed inset-0 bg-black/55 z-[99997] opacity-0 pointer-events-none transition-opacity duration-300 lg:hidden';

  // 3. Drawer(서랍 메뉴) 생성
  const drawer = document.createElement('div');
  drawer.id = 'mobile-sidebar-drawer';
  drawer.className = 'fixed inset-y-0 left-0 w-[280px] bg-white z-[99998] shadow-2xl transform -translate-x-full transition-transform duration-300 flex flex-col lg:hidden';

  // Drawer 내부 마크업
  const menuHtml = filteredMenuItems.map(item => {
    const isActive = item.key === activeKey;
    const activeClass = isActive
      ? 'bg-amber-50 text-amber-600 border-l-4 border-[#F2C130]'
      : 'text-gray-700 hover:bg-gray-100';
    const mbClass = item.mb5 ? 'mb-4' : '';
    const targetAttr = item.target ? `target="${item.target}"` : '';

    return `
      <a href="${item.href}" ${targetAttr} class="block no-underline">
        <div class="text-lg font-bold px-4 py-3 rounded-lg cursor-pointer transition-colors ${activeClass} ${mbClass}">
          ${item.label}
        </div>
      </a>
    `;
  }).join('');

  drawer.innerHTML = `
    <div class="p-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
      <div class="flex items-center gap-2">
        <img src="https://sfinbtiqlfnaaarziixu.supabase.co/storage/v1/object/public/baikuk-images-open/pabicon-baikuk-simbol.png" class="h-6 w-auto" alt="Logo" />
        <span class="font-extrabold text-lg text-gray-800">백억지도 메뉴</span>
      </div>
      <button id="mobile-sidebar-close-btn" class="text-3xl font-light text-gray-400 hover:text-black focus:outline-none leading-none">&times;</button>
    </div>
    <div class="flex-1 overflow-y-auto p-4 space-y-2">
      ${menuHtml}
    </div>
    <div class="p-4 border-t border-gray-200 text-center text-xs text-gray-400 bg-gray-50">
      © 백억지도 Admin Mobile
    </div>
  `;

  // body에 요소들 추가
  document.body.appendChild(toggleBtn);
  document.body.appendChild(backdrop);
  document.body.appendChild(drawer);

  // 메뉴 열기/닫기 제어
  const openMenu = () => {
    // 상대방(고객목록)이 열려있다면 닫기
    const customerCloseBtn = document.getElementById('mobile-customer-close-btn');
    if (customerCloseBtn) customerCloseBtn.click();

    backdrop.classList.remove('opacity-0', 'pointer-events-none');
    backdrop.classList.add('opacity-100');
    drawer.classList.remove('-translate-x-full');
  };

  const closeMenu = () => {
    backdrop.classList.remove('opacity-100');
    backdrop.classList.add('opacity-0', 'pointer-events-none');
    drawer.classList.add('-translate-x-full');
  };
  backdrop.classList.add('opacity-0', 'pointer-events-none');
  drawer.classList.add('-translate-x-full');

  const toggleMenu = () => {
    if (drawer.classList.contains('-translate-x-full')) {
      openMenu();
    } else {
      closeMenu();
    }
  };

  toggleBtn.addEventListener('click', toggleMenu);
  backdrop.addEventListener('click', closeMenu);

  // 닫기 버튼 이벤트 연결
  setTimeout(() => {
    const closeBtn = document.getElementById('mobile-sidebar-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeMenu);
  }, 100);
}

/**
 * 지정된 컨테이너에 사이드바를 동적으로 생성 및 주입합니다.
 * @param {string} activeKey 현재 활성화된 페이지 키
 * @param {string} [containerId='sidebar-container'] 사이드바가 들어갈 div ID
 */
export async function renderSidebar(activeKey, containerId = 'sidebar-container') {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`[Sidebar] Container element with id "${containerId}" not found.`);
    return;
  }

  // 모바일 스타일 동적 삽입
  injectMobileStyles();

  // 레이아웃 스타일 보장
  container.className = 'w-[6%] pt-[5rem] shadow-right text-center bg-white';

  let showAdManagement = false;
  try {
    await waitForSupabase();
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData?.session?.user;
    if (user?.id) {
      const { data: staff } = await supabase
        .from('staff_profiles')
        .select('authority_grade')
        .eq('user_id', user.id)
        .maybeSingle();

      if (staff && String(staff.authority_grade || '').trim() === '1') {
        showAdManagement = true;
      }
    }
  } catch (e) {
    console.warn('[Sidebar] 권한 확인 실패:', e);
  }

  // 권한에 맞춰 메뉴 필터링
  const filteredMenuItems = menuItems.filter(item => {
    if (item.key === 'ad_management') {
      return showAdManagement;
    }
    return true;
  });

  // 모바일용 햄버거 메뉴 렌더링
  renderMobileMenu(filteredMenuItems, activeKey);

  const html = filteredMenuItems.map(item => {
    const isActive = item.key === activeKey;
    const activeClass = isActive
      ? 'bg-gray-100 border-l-4 border-gray-500'
      : '';
    const mbClass = item.mb5 ? 'mb-5' : '';
    const targetAttr = item.target ? `target="${item.target}"` : '';

    return `
      <a href="${item.href}" ${targetAttr}>
        <div class="text-lg font-extrabold px-2 py-1 rounded hover:bg-gray-200 cursor-pointer ${activeClass} ${mbClass}">
          ${item.label}
        </div>
      </a>
    `;
  }).join('');

  container.innerHTML = html;
}

