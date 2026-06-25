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
