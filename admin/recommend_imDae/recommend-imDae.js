import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.3/+esm';
import { renderSidebar } from '../../modules/ui/sidebar.js';

// 사이드바 렌더링
renderSidebar('recommend_imDae');

// 모바일용 고객창(customer-col) 토글 설정
setupMobileCustomerCol();


const supabase = createClient(
  'https://sfinbtiqlfnaaarziixu.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmaW5idGlxbGZuYWFhcnppaXh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI1MDkxNjEsImV4cCI6MjA2ODA4NTE2MX0.4-7vnIjbF-biWWuv9-vTxK9Y99gMm-vS6oaRMdRL5fA'
);

// ─────────────────────────────────────────
// white-box resize 코드
// ─────────────────────────────────────────
(() => {
  const box = document.getElementById('white-box');
  const handle = document.getElementById('whitebox-resize-handle');

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = box.offsetWidth;
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const delta = e.clientX - startX;
    const newWidth = startWidth + delta;

    const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const extraGap = remPx * 2; // 3rem

    const table = document.querySelector('#white-box table');
    const tableWidth = table ? table.offsetWidth : 0;

    const minWidth = tableWidth + extraGap; // table + 3rem

    if (newWidth >= minWidth) {
      box.style.width = newWidth + 'px';
    }
  });

  window.addEventListener('mouseup', () => {
    if (isResizing) {
      const table = document.querySelector('#white-box table');
      const box = document.getElementById('white-box');

      const tableWidth = table.offsetWidth;
      const boxWidth = box.offsetWidth;

      window.whiteBoxExtraGap = boxWidth - tableWidth;
    }

    isResizing = false;
    document.body.style.userSelect = '';
  });
})();

// ─────────────────────────────────────────
// white-box 초기 사이즈 설정
// ─────────────────────────────────────────
function initializeWhiteBoxWidth() {
  const box = document.getElementById('white-box');
  const table = document.querySelector('#white-box table');
  if (!box || !table) return;

  const tableWidth = table.offsetWidth;
  const boxWidth = box.offsetWidth;

  window.whiteBoxExtraGap = boxWidth - tableWidth;

  box.style.width = (tableWidth + window.whiteBoxExtraGap) + 'px';
}

window.addEventListener("load", initializeWhiteBoxWidth);

// ─────────────────────────────────────────
// 로그인 체크 + 정산 탭 표시/숨김
// ─────────────────────────────────────────
(async () => {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) console.warn("세션 조회 에러:", error);
    if (!data?.session) {
      console.warn("로그인 세션 없음 → 이동");
      location.replace("https://baikuk-map.netlify.app/admin/listings/");
      return;
    }

    const guardClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      alert('직원 권한은 정산 메뉴에 접근할 수 없습니다.');
    };

    const showOrHideSettlementTab = async () => {
      const tab = document.getElementById('settlement-tab');
      if (!tab) return;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return;

      const { data: me, error: authErr } = await supabase
        .from('staff_profiles')
        .select('authority')
        .eq('user_id', user.id)
        .maybeSingle();

      if (authErr) {
        console.warn('authority 조회 실패:', authErr);
        return;
      }

      const role = (me?.authority || '').trim();
      if (role === '직원') {
        tab.style.display = 'none';
        tab.addEventListener('click', guardClick, { once: true });
      } else {
        tab.style.removeProperty('display');
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showOrHideSettlementTab, { once: true });
    } else {
      showOrHideSettlementTab();
    }
  } catch (e) {
    console.warn('정산탭 처리 중 예외:', e);
  }
})();

// 전역 노출
window.supabase = supabase;

// ─────────────────────────────────────────
// 모바일 등급별 고객창 (customer-col) Drawer 처리
// ─────────────────────────────────────────
function injectMobileCustomerColStyles() {
  if (document.getElementById('mobile-customer-col-styles')) return;

  const style = document.createElement('style');
  style.id = 'mobile-customer-col-styles';
  style.innerHTML = `
    @media (max-width: 1024px) {
      #customer-col {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        bottom: 0 !important;
        width: 280px !important;
        max-width: 85% !important;
        height: 100vh !important;
        z-index: 99990 !important;
        background-color: #f3f4f6 !important; /* bg-gray-100 */
        box-shadow: 10px 0 25px -5px rgba(0, 0, 0, 0.15) !important;
        transform: translateX(-100%) !important;
        transition: transform 0.3s ease-in-out !important;
        padding-top: 1rem !important;
      }
      
      #customer-col.open {
        transform: translateX(0) !important;
      }

      /* 모바일 레이아웃 점유 무력화 */
      .flex > div#customer-col {
        width: 0 !important;
        min-width: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
      }
      
      #customer-list {
        max-height: calc(100vh - 8rem) !important;
        padding: 0 1rem 2rem 1rem !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function setupMobileCustomerCol() {
  injectMobileCustomerColStyles();

  const customerCol = document.getElementById('customer-col');
  if (!customerCol) return;

  // 1. 토글 버튼 생성 (좌측 하단 초록색 플로팅 버튼)
  let toggleBtn = document.getElementById('mobile-customer-toggle-btn');
  if (!toggleBtn) {
    toggleBtn = document.createElement('div');
    toggleBtn.id = 'mobile-customer-toggle-btn';
    toggleBtn.className = 'fixed bottom-6 left-6 z-[99999] bg-[#4CAF50] hover:bg-[#45a049] text-white w-14 h-14 rounded-full flex items-center justify-center shadow-2xl cursor-pointer select-none transition-transform duration-200 active:scale-95 lg:hidden';
    toggleBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    `;
    document.body.appendChild(toggleBtn);
  }

  // 2. 어두운 배경(Backdrop) 생성
  let backdrop = document.getElementById('mobile-customer-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'mobile-customer-backdrop';
    backdrop.className = 'fixed inset-0 bg-black/55 z-[99989] opacity-0 pointer-events-none transition-opacity duration-300 lg:hidden';
    document.body.appendChild(backdrop);
  }

  // 3. 닫기 버튼 생성 (고객창 상단 영역)
  let closeBtn = document.getElementById('mobile-customer-close-btn');
  if (!closeBtn) {
    const titleContainer = customerCol.querySelector('.flex.justify-end'); // 새 고객 버튼 영역
    if (titleContainer) {
      closeBtn = document.createElement('button');
      closeBtn.id = 'mobile-customer-close-btn';
      closeBtn.className = 'mr-auto text-2xl font-light text-gray-500 hover:text-black focus:outline-none pl-3 lg:hidden';
      closeBtn.innerHTML = '&times;';
      titleContainer.insertBefore(closeBtn, titleContainer.firstChild);
      
      titleContainer.classList.remove('justify-end');
      titleContainer.classList.add('justify-between', 'items-center');
    }
  }

  const openCol = () => {
    backdrop.classList.remove('opacity-0', 'pointer-events-none');
    backdrop.classList.add('opacity-100');
    customerCol.classList.add('open');
  };

  const closeCol = () => {
    backdrop.classList.remove('opacity-100');
    backdrop.classList.add('opacity-0', 'pointer-events-none');
    customerCol.classList.remove('open');
  };

  toggleBtn.addEventListener('click', () => {
    if (customerCol.classList.contains('open')) {
      closeCol();
    } else {
      openCol();
    }
  });
  
  backdrop.addEventListener('click', closeCol);
  if (closeBtn) {
    closeBtn.addEventListener('click', closeCol);
  }

  // 4. 모바일에서 고객 선택 시 자동으로 서랍 닫기
  const customerList = document.getElementById('customer-list');
  if (customerList) {
    customerList.addEventListener('click', (e) => {
      const isName = e.target.classList.contains('customer-name') || e.target.closest('.customer-name');
      const isItem = e.target.classList.contains('customer-list-item') || e.target.closest('.customer-list-item');
      const isDelete = e.target.innerHTML === '&times;' || e.target.closest('button')?.innerHTML === '&times;';

      if ((isName || isItem) && !isDelete) {
        if (window.innerWidth <= 1024) {
          closeCol();
        }
      }
    });
  }
}

