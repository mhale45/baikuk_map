import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.3/+esm';

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
