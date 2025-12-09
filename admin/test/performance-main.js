import { client } from '../../../modules/core/supabase.js';
import { waitForSupabase } from '../../../modules/core/supabase.js';
import { buildListingTitle, buildAddress } from '../../../modules/data/listing.js';
import { getMyAffiliation } from '../../../modules/auth/profile.js';
import { showToastGreenRed } from '../../../modules/ui/toast.js';
import { autosizeInputByCh } from '../../../modules/ui/autosize.js';

window.supabase = client;
document.dispatchEvent(new Event('supabase-ready'));

function formatYYMMDD(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';

  const yy = String(d.getFullYear()).slice(2);   // "25"
  const mm = String(d.getMonth() + 1).padStart(2, '0'); // "12"
  const dd = String(d.getDate()).padStart(2, '0');      // "03"
  return yy + mm + dd; // "251203"
}

// === 정산 탭 제어(권한별 표시/차단) ===
(async () => {
  try {
    await waitForSupabase();
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr) console.warn('세션 조회 에러:', sessionErr);

    const user = sessionData?.session?.user;
    const tab = document.getElementById('settlement-tab');
    if (!tab) return;

    // 로그인 아니면 굳이 보일 필요 없음
    if (!user?.id) {
      tab.style.display = 'none';
      return;
    }

    const { data: me, error: authErr } = await supabase
      .from('staff_profiles')
      .select('authority')
      .eq('user_id', user.id)
      .maybeSingle();

    if (authErr) {
      console.warn('authority 조회 실패:', authErr);
      // 실패 시 기본 숨김 유지
      tab.style.display = 'none';
      return;
    }

    // 직원 클릭 가드 (혹시 일시적으로 보였을 때 대비)
    const guardClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const toast = document.getElementById('toast');
      if (toast) {
        toast.textContent = '직원 권한은 정산 메뉴에 접근할 수 없습니다.';
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 3000);
      }
    };

    if (me?.authority?.trim() === '직원') {
      // 직원: 숨김 + 클릭 방지(중복 등록 방지 포함)
      tab.style.display = 'none';
      tab.removeEventListener('click', guardClick);
      tab.addEventListener('click', guardClick, { once: false });
    } else {
      // 관리자/지점장: 노출 + 기존 guard 제거
      tab.style.removeProperty('display');
      // 모든 기존 리스너 초기화(가드 제거 목적)
      tab.replaceWith(tab.cloneNode(true));
    }
  } catch (e) {
    console.warn('정산 탭 제어 중 예외:', e);
  }
})();

import {
  STAFF_NAME_BY_ID,
} from './performance.js';
import {
  updateSalesTotal, computeSalesTotalForCurrentContext, sumForStaffIds,
  registerPerformanceRenderer, setPerformanceRows, enforceComputedReadOnly, initSalesLocationSelects, fetchAllPCD, createAllocationItem, resetForm,
  collectAllocationPayloadRow, collectPerformancePayload, enableAutoGrowTextArea, validateTotalWeight, updateHighlight,
  calculateDownPaymentAndBalance, ensureStaffNameMap, calculateFees, recalcPerformanceFromFees,
  populateAllStaffSelects, buildDateBlock, buildPriceBlock, populateAffiliationSelect,STAFF_AFF_BY_ID
} from './performance.js';

window.updateHighlight = updateHighlight;

import {
  formatNumberWithCommas, attachCommaFormatter, formatIdsWithCommas, formatArea1, numOrNull, intOrNull, dateOrNull,
} from '../../../modules/core/format.js';

(async () => {
  const { data } = await supabase.auth.getSession();
  if (!data?.session) location.replace("/");
})();

// 직원/지점 패널: 목록 렌더 + 권한별 클릭 허용 + 클릭 시 필터
(async () => {
  // 0) 내 권한/소속/내 스태프ID
  const me = await getMyAuthorityAndStaffId(); // { authority, isStaff, staffId, affiliation, userId }

  // 1) 직원 데이터 로드 (권한별 재직자 필터)
  let staffQuery = supabase
    .from('staff_profiles')
    .select('id, name, affiliation, leave_date')
    .order('affiliation', { ascending: true })
    .order('name', { ascending: true });

  if (me.authority === '직원') {
    // 직원 권한은 재직자만 보이도록
    staffQuery = staffQuery.is('leave_date', null);
  }

  const { data, error } = await staffQuery;
    
  if (error) {
    console.error('직원 정보 실패:', error);
    return;
  }

  // 2) 소속별 묶기
  const grouped = {};
  (data || []).forEach(({ id, name, affiliation, leave_date }) => {
    if (!grouped[affiliation]) grouped[affiliation] = { active: [], inactive: [] };
    const entry = { id, name, affiliation, leave_date };
    if (!leave_date) grouped[affiliation].active.push(entry);
    else grouped[affiliation].inactive.push(entry);

    // [ADD] 지점 -> 직원ID 세트 캐시
    if (!__AFFIL_STAFF_IDS[affiliation]) __AFFIL_STAFF_IDS[affiliation] = new Set();
    __AFFIL_STAFF_IDS[affiliation].add(String(id));
  });


  const container = document.getElementById('staff-list');
  container.innerHTML = '';

  // 3) 권한별 클릭 가능 여부
  const canClickStaff = (emp) => {
    if (me.authority === '관리자') return true;
    if (me.authority === '지점장') return emp.affiliation === me.affiliation;
    if (me.authority === '직원')   return String(emp.id) === String(me.staffId);
    return false;
  };
  const canClickAff = (aff) => {
    if (me.authority === '관리자') return true;
    if (me.authority === '지점장') return aff === me.affiliation;
    // 직원은 지점 전체 보기 금지
    return false;
  };

  // 4) 렌더
  let firstClickableStaffEl = null;

  Object.entries(grouped).forEach(([aff, { active, inactive }], idx) => {
    // --- 지점 헤더 (클릭 시 지점 전체 필터) ---
    const header = document.createElement('div');
    header.className = 'grade-header select-none';
    header.textContent = aff;

    if (canClickAff(aff)) {
      header.classList.add('cursor-pointer', 'hover:bg-yellow-100');
      header.title = '이 지점의 모든 매출 보기';
      header.addEventListener('click', () => {
        // 토글: 같은 지점을 다시 누르면 해제
        if (window.__selectedAffiliation === aff) {
          window.__selectedAffiliation = null;
          header.classList.remove('ring-2', 'ring-yellow-400');
        } else {
          window.__selectedAffiliation = aff;
          // 지점 필터를 켜면 직원 단일 선택은 해제
          window.__selectedStaffId = null;
          // 헤더 하이라이트 갱신
          container.querySelectorAll('.grade-header').forEach(h => h.classList.remove('ring-2','ring-yellow-400'));
          header.classList.add('ring-2', 'ring-yellow-400');
          // 직원 선택 하이라이트 제거
          container.querySelectorAll('.name-item').forEach(el => el.classList.remove('bg-yellow-200'));
        }
        Promise.resolve(loadPerformanceTable()).then(() => {
          window.__updateSalesTotalFromIndex?.();
          window.updateDepositVisibility?.();
        });
      });
    } else {
      header.classList.add('opacity-60');
      header.title = '이 지점은 조회 권한이 없습니다.';
    }
    container.appendChild(header);

    // --- 직원 리스트 ---
    const makeName = (emp, { dim = false } = {}) => {
      const el = document.createElement('div');
      el.className = 'name-item';
      el.dataset.staffId = emp.id;
      el.textContent = dim ? `${emp.name} (퇴사)` : emp.name;

      const allowed = canClickStaff(emp);
      if (!allowed) {
        // 클릭 불가 표시
        el.classList.add('opacity-50', 'pointer-events-none', 'select-none');
        el.dataset.disabled = '1';
      } else {
        // 클릭 가능 표시
        el.classList.add('cursor-pointer', 'hover:bg-yellow-100');
        if (!firstClickableStaffEl) firstClickableStaffEl = el;
      }
      return el;
    };

    active.forEach((emp) => container.appendChild(makeName(emp)));
    // --- 퇴사자 토글/목록 (관리자/지점장만 노출) ---
    if (me.authority !== '직원' && inactive.length > 0) {
      const toggleBtn = document.createElement('button');
      toggleBtn.textContent = '▼ 퇴사자 보기';
      toggleBtn.className = 'text-sm text-blue-600 hover:underline ml-2 mb-1';

      const collapseDiv = document.createElement('div');
      collapseDiv.className = 'pl-4 mt-1 hidden';
      collapseDiv.id = `inactive-group-${idx}`;

      inactive.forEach((emp) => {
        const el = document.createElement('div');
        el.className = 'name-item text-gray-400 italic';
        el.dataset.staffId = emp.id;
        el.textContent = `${emp.name} (퇴사)`;
        collapseDiv.appendChild(el);
      });

      toggleBtn.onclick = () => {
        const expanded = collapseDiv.classList.toggle('hidden');
        toggleBtn.textContent = expanded ? '▲ 퇴사자 숨기기' : '▼ 퇴사자 보기';
      };

      container.appendChild(toggleBtn);
      container.appendChild(collapseDiv);
    }

  });

  // 5) 직원 클릭 → 단일 직원 필터 (지점 필터 해제)
  function setActiveStaff(staffId) {
    window.__selectedStaffId = staffId;
    window.__selectedAffiliation = null; // 직원 선택 시 지점 필터 해제

    // UI 하이라이트
    container.querySelectorAll('.grade-header').forEach(h => h.classList.remove('ring-2','ring-yellow-400'));
    container.querySelectorAll('.name-item').forEach(el => {
      if (el.dataset.disabled === '1') return;
      if (String(el.dataset.staffId) === String(staffId)) {
        el.classList.add('bg-yellow-200');
      } else {
        el.classList.remove('bg-yellow-200');
      }
    });

    // 테이블 갱신 + 합계 즉시 갱신
    Promise.resolve(loadPerformanceTable()).then(() => {
      window.__updateSalesTotalFromIndex?.();
      window.updateDepositVisibility?.();
    });
  }
  container.addEventListener('click', (e) => {
    const el = e.target.closest('.name-item');
    if (!el || el.dataset.disabled === '1') return;
    setActiveStaff(el.dataset.staffId);
  });

  // 6) UX: 직원 권한이면 본인을 자동 선택
  if (me.isStaff && me.staffId) {
    setActiveStaff(me.staffId);
  } else {
    // 지점장/관리자: 자동선택 없음 (원하면 주석 해제)
    // if (firstClickableStaffEl) setActiveStaff(firstClickableStaffEl.dataset.staffId);
  }
})();


(async () => {
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes?.user;
  let role = user?.user_metadata?.role || user?.app_metadata?.role;

  if (!role && user?.id) {
    const { data: prof } = await supabase
      .from('staff_profiles')
      .select('authority')
      .eq('user_id', user.id)
      .maybeSingle();
    role = prof?.authority;
  }

  window.__userRole = role;
  window.__isStaff = role === '직원';

  const distEl = document.getElementById('f_seller_distribution_rate');
  if (distEl) {
    if (window.__isStaff) {
      distEl.value ||= 30;
      distEl.readOnly = true;
      distEl.classList.add('bg-gray-100', 'cursor-not-allowed');
      ['keydown','beforeinput','paste','drop'].forEach(ev => distEl.addEventListener(ev, e => e.preventDefault()));
      distEl.addEventListener('input', () => distEl.value = 30);
      distEl.title = '직원 권한은 분배율을 변경할 수 없습니다.';
    } else {
      distEl.readOnly = false;
      distEl.classList.remove('bg-gray-100', 'cursor-not-allowed');
    }
  }
})();

// 스크립트 추가
let currentPerformanceId = null;   // ← 추가: 열람/수정 중인 매출 ID
let _pcdCache = null;
let __saving = false; // 중복 저장 방지 플래그
let isDownPaymentAutoFilled = false;
let currentCustomerId = null;
window.__selectedStaffId = null; // ← [ADD] 왼쪽 패널에서 선택한 직원 ID(문자열/숫자). null이면 '전체' 의미
window.__selectedAffiliation = null; // ← [ADD] 왼쪽 패널에서 선택한 지점(affiliation). null이면 지점 필터 해제
// [FIX] 지점(affiliation) -> 해당 직원 ID Set 캐시 (window 전역과 동기화)
const __AFFIL_STAFF_IDS = (window.__AFFIL_STAFF_IDS ||= {});

// 지점 기준 합계 업데이트: 
//  - 입금해줘야 할 금액(pay):   담당지점 === 현재지점 && 직원소속 !== 현재지점
//  - 입금받아야 할 금액(receive): 담당지점 !== 현재지점 && 직원소속 === 현재지점
window.__updateSalesTotalFromIndex = async function __updateSalesTotalFromIndex() {
  const currentAff = window.__selectedAffiliation || null;

  const $pay   = document.getElementById('payAmount');
  const $recv  = document.getElementById('receiveAmount');
  const $payBD = document.getElementById('branchBreakdownPay');
  const $rvBD  = document.getElementById('branchBreakdownRecv');

  const fmt = (n) => new Intl.NumberFormat('ko-KR').format(Math.round(n));

  // 지점 미선택 상태면 0/빈 브레이크다운
  if (!currentAff) {
    if ($payBD) $payBD.textContent = '';
    if ($rvBD)  $rvBD.textContent  = '';
    return;
  }

  // 직원ID → 지점 맵 보장
  await ensureStaffNameMap();

  const rows = Array.isArray(window.__PERF_ROWS) ? window.__PERF_ROWS : [];
  let toPay = 0;      // 총 입금해줘야
  let toReceive = 0;  // 총 입금받아야

  // 지점별 브레이크다운
  // - payByAff  : 우리가 입금해줘야 하는 대상 지점(= 타지점 직원의 소속)
  // - recvByAff : 우리가 입금받아야 하는 출처 지점(= 타지점 담당지점)
  const payByAff  = new Map();
  const recvByAff = new Map();

  for (const row of rows) {
    const perfAff = (row?.affiliation || '').trim();

    // allocations: 중첩/납작 모두 처리
    const pa = Array.isArray(row?.performance_allocations)
      ? row.performance_allocations[0]
      : row?.performance_allocations;

    if (!pa) continue;

    for (let i = 1; i <= 4; i++) {
      const sid = pa[`staff_id${i}`];
      if (!sid) continue;

      const buyerAmt  = Number(pa[`buyer_amount${i}`]  || 0);
      const sellerAmt = Number(pa[`seller_amount${i}`] || 0);
      const savedInv  = pa[`involvement_sales${i}`];

      const amt = typeof savedInv === 'number' && !Number.isNaN(savedInv)
        ? Number(savedInv)
        : (buyerAmt + sellerAmt);
      if (amt <= 0) continue;

      const staffAff = (STAFF_AFF_BY_ID.get(String(sid)) || '').trim();
      if (!staffAff) continue;

      // 규칙 1) 우리 담당건 + 타지점 직원 → 우리가 '입금해줘야' (대상: staffAff)
      if (perfAff === currentAff && staffAff !== currentAff) {
        toPay += amt;
        payByAff.set(staffAff, (payByAff.get(staffAff) || 0) + amt);
      }
      // 규칙 2) 타지점 담당건 + 우리 직원 → 우리가 '입금받아야' (출처: perfAff)
      else if (perfAff !== currentAff && staffAff === currentAff) {
        toReceive += amt;
        recvByAff.set(perfAff, (recvByAff.get(perfAff) || 0) + amt);
      }
    }
  }

  // 브레이크다운 렌더러
  const renderBD = (map, title, el) => {
    if (!el) return;
    if (!map || map.size === 0) {
      el.textContent = `${title}>> -`;
      return;
    }
    // 금액 내림차순 정렬
    const items = [...map.entries()].sort((a,b) => b[1]-a[1]);
    const body = items.map(([aff, v]) => `${aff}: ${fmt(v)}원`).join(' · ');
    el.textContent = `${title}>> ${body}`;
  };

  // 표시
  renderBD(payByAff,  '줄돈',  $payBD);   // 대상 지점별 (타지점 직원 소속)
  renderBD(recvByAff, '받을돈', $rvBD);    // 출처 지점별 (타지점 담당지점)
};

// === [ADD] 폼 편집 가능/불가 토글 ===
function setFormEditable(enabled) {
  const drawer = document.getElementById('sales-drawer');
  if (!drawer) return;

  // 입력계열
  drawer.querySelectorAll('input, select, textarea').forEach(el => {
    // 닫기 버튼 같은 건 제외
    if (el.id === 'f_status') return; // 상태버튼은 아래에서 별도 처리
    if (enabled) {
      el.disabled = false;
      el.readOnly = false;
      el.classList.remove('bg-gray-50', 'text-gray-500', 'cursor-not-allowed');
    } else {
      // select는 disabled, input/textarea는 readOnly + 비주얼
      if (el.tagName === 'SELECT') el.disabled = true;
      else el.readOnly = true;
      el.classList.add('bg-gray-50', 'text-gray-500', 'cursor-not-allowed');
    }
  });

  // 저장 버튼
  const saveBtn = document.getElementById('save-sales');
  if (saveBtn) {
    saveBtn.disabled = !enabled;
    saveBtn.classList.toggle('opacity-50', !enabled);
    saveBtn.classList.toggle('cursor-not-allowed', !enabled);
  }

  // 확정 버튼
  const statusBtn = document.getElementById('f_status');
  if (statusBtn) {
    if (enabled) {
      statusBtn.disabled = false;
      statusBtn.textContent = '매출확정';
      statusBtn.classList.remove('bg-gray-400');
      statusBtn.classList.add('bg-red-500');
    } else {
      statusBtn.disabled = true;
      statusBtn.textContent = '확정됨';
      statusBtn.classList.remove('bg-red-500');
      statusBtn.classList.add('bg-gray-400');
    }
  }
}

// === [ADD] 잔금일/확정 상태에 따른 행 배경색 적용 ===
// - 잔금일이 2일 초과로 남음: 옅은 초록(#f0fdf4)
// - 잔금일이 0~2일 이내: 더 짙은 초록(#bbf7d0)
// - 잔금일 지남 && 미확정(status=false): 빨강(#fecaca)
function applyRowStatusColor(tr, row) {
  if (!row?.balance_date) return;

  // [NEW] 확정이면 무조건 흰색 우선
  if (row.status === true || row.status === 'true') {
    tr.style.backgroundColor = 'white';
    return;
  }

  // YYYY-MM-DD → 로컬 자정 Date
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(row.balance_date);
  if (!m) return;
  const bd = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); // 잔금일 00:00

  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // 오늘 00:00
  const diffDays = Math.floor((bd - today0) / 86400000); // 잔금일까지 남은 '정수' 일수

  // [COLOR RULE]
  // - diffDays > 2 : 연한 초록
  // - 0 ≤ diffDays ≤ 2 : 진한 초록
  // - diffDays < 0 : 빨강
  if (diffDays > 2) {
    tr.style.backgroundColor = '#f0fdf4'; // 옅은 초록
  } else if (diffDays >= 0) {
    tr.style.backgroundColor = '#bbf7d0'; // 진한 초록
  } else {
    tr.style.backgroundColor = '#fecaca'; // 연한 빨강
  }
}

// === 매출확정: status=true 업데이트 + 폼 잠금 ===
document.getElementById('f_status')?.addEventListener('click', async () => {
  // 신규 작성 상태(아직 저장 전)면 확정 불가
  if (!currentPerformanceId) {
    showToastGreenRed('먼저 매출을 저장한 뒤 확정할 수 있습니다.');
    return;
  }

  // 사용자 확인
  if (!confirm('매출을 확정하면 수정할 수 없습니다. 진행하시겠습니까?')) return;

  try {
    // DB 업데이트
    const { error } = await window.supabase
      .from('performance')
      .update({ status: true })
      .eq('id', currentPerformanceId);

    if (error) {
      showToastGreenRed('매출 확정 실패: ' + error.message);
      return;
    }

    // 폼 잠금 & UI 반영
    setFormEditable(false);
    showToastGreenRed('매출이 확정되었습니다.', { ok: true });

    // 리스트 새로고침 (현재 행의 status 반영)
    await loadPerformanceTable();
    window.updateDepositVisibility?.();
  } catch (e) {
    console.error(e);
    showToastGreenRed('예상치 못한 오류가 발생했습니다.');
  }
});


// === [REPLACE] 내 권한/스태프ID/소속 조회 (user_id 기준) ===
async function getMyAuthorityAndStaffId() {
  await waitForSupabase();
  const { data: sessionRes, error: sErr } = await supabase.auth.getSession();
  if (sErr) throw sErr;

  const user = sessionRes?.session?.user;
  if (!user?.id) throw new Error('로그인이 필요합니다.');

  // 내 staff_profiles (id, authority, affiliation)
  const { data: staff, error: spErr } = await supabase
    .from('staff_profiles')
    .select('id, authority, affiliation')
    .eq('user_id', user.id)
    .maybeSingle();

  if (spErr) throw spErr;
  if (!staff) throw new Error('staff_profiles에서 사용자 정보를 찾을 수 없습니다.');

  const authority = staff.authority || '';
  const isStaff = authority === '직원';

  window.__MY_STAFF_ID = staff.id;
  // 전역 동기화
  window.__userRole = authority;
  window.__isStaff  = isStaff;

  // affiliation 추가로 반환 (지점장 필터에 사용)
  return { authority, isStaff, staffId: staff.id, affiliation: staff.affiliation, userId: user.id };
}

function openDrawer() {
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => {
  drawer.classList.remove('translate-x-full');
  });
  initSalesLocationSelects();
  populateAffiliationSelect?.();
}
function closeDrawer() {
  drawer.classList.add('translate-x-full');
  overlay.classList.add('hidden');
  currentPerformanceId = null;
}

// === [ADD] 입금액 표시/숨김 제어 ===
// 직원 단일 선택(__selectedStaffId)이 있을 때만 보이고,
// 지점 보기(__selectedAffiliation)일 때는 숨김
function updateDepositVisibility() {
  const el = document.getElementById('depositAmount');
  if (!el) return;

  const show = !!window.__selectedStaffId && !window.__selectedAffiliation;

  // hidden 클래스로 제어( Tailwind 'hidden' = display:none )
  el.classList.toggle('hidden', !show);

  // 보이게 될 때 현재 매출합계 기준으로 즉시 재계산/반영
  if (show) {
    window.__recalcDepositAmountFromSalesTotal?.();
  }
}
// 전역 훅으로 노출 + 초기 1회 적용
window.updateDepositVisibility = updateDepositVisibility;
updateDepositVisibility();

// === [ADD] 관여매출 합계 → 입금액(절반 후 3.3% 공제) 표시 ===
// salesTotal 내용이 변할 때 자동으로 우측의 '입금액:'을 갱신해준다.
// (updateSalesTotal 직접 수정 없이 MutationObserver로 감지)
(function setupDepositAmountMirror() {
  const salesTotalEl = document.getElementById('salesTotal');
  const depositEl = document.getElementById('depositAmount');
  if (!salesTotalEl || !depositEl) return;

  // "관여매출 합계: 12,345원" → 12345
  const parseWonNumber = (text) => {
    const m = String(text || '').match(/([\d,]+)/);
    return m ? Number(m[1].replace(/,/g, '')) : 0;
    // 숫자 없으면 0 처리
  };

  // 합계의 절반에서 3.3% 공제 = 합계 × 0.5 × (1 - 0.033) = 합계 × 0.4835
  const recalcAndRender = () => {
    const total = parseWonNumber(salesTotalEl.textContent);
    const deposit = Math.max(0, Math.round(total * 0.4835));
    // formatNumberWithCommas는 상단 import로 이미 존재
    depositEl.textContent = `입금액: ${formatNumberWithCommas(deposit)}원`;
  };

  // 초기 1회 계산
  recalcAndRender();

  // salesTotal 텍스트 변화를 감지해서 자동 재계산
  const mo = new MutationObserver(recalcAndRender);
  mo.observe(salesTotalEl, { childList: true, characterData: true, subtree: true });

  // 필요 시 외부에서 강제 호출용 훅
  window.__recalcDepositAmountFromSalesTotal = recalcAndRender;
})();

// [ADD] UI 날짜 필터 읽기
function readDateFilter() {
  const fieldEl = document.getElementById('filter-date-field');
  const startEl = document.getElementById('filter-start-date');
  const endEl   = document.getElementById('filter-end-date');
  return {
    field: (fieldEl?.value || 'contract_date'),
    start: (startEl?.value || ''),
    end:   (endEl?.value   || '')
  };
}

// === [REPLACE] 권한별(직원/지점장/기타) + 선택직원/선택지점 필터 적용 로딩 함수 ===
async function loadPerformanceTable() {
  await ensureStaffNameMap();
  try {
    await waitForSupabase();

    // 1) 내 권한/스태프ID/소속
    let me = { authority: window.__userRole, isStaff: window.__isStaff, staffId: null, userId: null, affiliation: null };
    try { me = await getMyAuthorityAndStaffId(); }
    catch (e) { console.warn('[getMyAuthorityAndStaffId] 경고:', e?.message); }

    // 선택 상태
    let selectedId  = window.__selectedStaffId;
    let selectedAff = window.__selectedAffiliation;

    // 직원은 무조건 자기 자신만
    if (me?.isStaff) {
      selectedId  = me.staffId;
      selectedAff = null;
    }
    // 지점장: 다른 지점 클릭 방지 (UI에서 막지만 이중 방어)
    if (me?.authority === '지점장' && selectedAff && selectedAff !== me.affiliation) {
      selectedAff = me.affiliation;
    }

    // 2) select 구성: 직원/지점으로 필터할 땐 !inner 필요
    const needInnerJoin = me?.isStaff || me?.authority === '지점장' || !!selectedId || !!selectedAff;

    const selectBase = `
      id, listing_id, listing_title, province, city, district, detail_address,
      deal_type, sale_price, deposit_price, monthly_rent, premium_price, area_py, affiliation,
      contract_date, balance_date,
      down_payment, balance,
      interim_payment1, interim_payment1_date,
      interim_payment2, interim_payment2_date,
      interim_payment3, interim_payment3_date,
      buyer_fee, buyer_tax, buyer_tax_date,
      seller_fee, seller_tax, seller_tax_date,
      expense,
      special_contract,
      status,
      performance_allocations:performance_allocations${needInnerJoin ? '!inner' : ''}(
        staff_id1, staff_id2, staff_id3, staff_id4,
        buyer_weight1, buyer_weight2, buyer_weight3, buyer_weight4,
        seller_weight1, seller_weight2, seller_weight3, seller_weight4,
        buyer_amount1, buyer_amount2, buyer_amount3, buyer_amount4,
        seller_amount1, seller_amount2, seller_amount3, seller_amount4,
        involvement_sales1, involvement_sales2, involvement_sales3, involvement_sales4
      )
    `;

    let query = window.supabase
      .from('performance')
      .select(selectBase)
      .order('contract_date', { ascending: false });

    // 3) 권한별 범위 필터
    if (me?.isStaff && me?.staffId) {
      // 직원: 본인 배정건만
      const sid = me.staffId;
      query = query.or(
        `staff_id1.eq.${sid},staff_id2.eq.${sid},staff_id3.eq.${sid},staff_id4.eq.${sid}`,
        { foreignTable: 'performance_allocations' }
      );
    } else if (me?.authority === '지점장' && me?.affiliation) {
      // 지점장: 내 소속 모든 직원이 관여한 건
      const { data: branchStaff, error: affErr } = await supabase
        .from('staff_profiles')
        .select('id')
        .eq('affiliation', me.affiliation);

      if (!affErr && Array.isArray(branchStaff) && branchStaff.length) {
        const ids = branchStaff.map(r => r.id).filter(v => v != null);
        const idList = ids.join(',');
        query = query.or(
          `staff_id1.in.(${idList}),staff_id2.in.(${idList}),staff_id3.in.(${idList}),staff_id4.in.(${idList})`,
          { foreignTable: 'performance_allocations' }
        );
      }
      // 관리자 등은 전체
    }

    // 4) 좌측 패널 “선택 직원”으로 추가 좁히기
    if (selectedId) {
      query = query.or(
        `staff_id1.eq.${selectedId},staff_id2.eq.${selectedId},staff_id3.eq.${selectedId},staff_id4.eq.${selectedId}`,
        { foreignTable: 'performance_allocations' }
      );
    }

    // 5) 좌측 패널 “선택 지점(affiliation)”으로 추가 좁히기
    if (!selectedId && selectedAff) {
      // 선택 직원이 없고 지점이 선택되었을 때만 적용
      const { data: affStaff, error: selErr } = await supabase
        .from('staff_profiles')
        .select('id')
        .eq('affiliation', selectedAff);

      if (!selErr && Array.isArray(affStaff) && affStaff.length) {
        const ids = affStaff.map(r => r.id).filter(v => v != null);
        const idList = ids.join(',');
        query = query.or(
          `staff_id1.in.(${idList}),staff_id2.in.(${idList}),staff_id3.in.(${idList}),staff_id4.in.(${idList})`,
          { foreignTable: 'performance_allocations' }
        );
      }
    }

    // [REPLACE] 날짜 조건: UI가 지정되면 UI를 우선해서 DB에 직접 적용,
    // 없으면(빈 값) 직원/지점 보기일 때만 "이번달 잔금일" 기본값 적용
    {
      const { field: uiField, start: uiStart, end: uiEnd } = readDateFilter();
      const fld = (uiField === 'balance_date') ? 'balance_date' : 'contract_date';

      if (uiStart || uiEnd) {
        // ✅ 사용자가 지정한 기간으로 DB 조회
        if (uiStart) query = query.gte(fld, uiStart);
        if (uiEnd)   query = query.lte(fld, uiEnd);
      } else if (selectedId || selectedAff) {
        // ✅ UI 비어있으면, 직원/지점 보기일 때만 "이번달 잔금일" 기본값
        const now = new Date();
        const first = new Date(now.getFullYear(), now.getMonth(), 1);
        const last  = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const toYMD = (d) => {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${day}`;
        };

        query = query.gte('balance_date', toYMD(first)).lte('balance_date', toYMD(last));

        // UI 표시도 동기화(사용자에게 기본값이 보이도록)
        const fieldEl = document.getElementById('filter-date-field');
        const startEl = document.getElementById('filter-start-date');
        const endEl   = document.getElementById('filter-end-date');
        if (fieldEl) fieldEl.value = 'balance_date';
        if (startEl) startEl.value = toYMD(first);
        if (endEl)   endEl.value   = toYMD(last);
      }
    }

    // 6) 실행
    const { data, error } = await query;
    if (error) {
      console.error('테이블 조회 실패:', error);
      showToastGreenRed('조회 실패: ' + error.message);
      return;
    }

    // 7) 렌더 함수 정의 + 등록
    const tbody = document.querySelector('#performance-table tbody');

    function renderPerformanceTable(rows) {
      tbody.innerHTML = '';
      // [ADD] 현재 화면에 렌더된 원본 데이터 보관
      window.__RENDERED_ROWS = rows || [];
      (rows || []).forEach(row => {
        const pa = Array.isArray(row.performance_allocations)
          ? row.performance_allocations[0]
          : row.performance_allocations;

        const names = [], buyerP = [], sellerP = [], inv = [];
        if (pa) {
          for (let i = 1; i <= 4; i++) {
            const sid = pa[`staff_id${i}`];
            const bw  = pa[`buyer_weight${i}`];
            const sw  = pa[`seller_weight${i}`];
            if (sid && ((bw ?? 0) > 0 || (sw ?? 0) > 0)) {
              names.push(STAFF_NAME_BY_ID.get(sid) || '-');
              buyerP.push(((bw ?? 0) * 100).toFixed(0) + '%');
              sellerP.push(((sw ?? 0) * 100).toFixed(0) + '%');

              const savedInv = pa?.[`involvement_sales${i}`];
              const buyerAmt = pa?.[`buyer_amount${i}`] ?? 0;
              const sellerAmt = pa?.[`seller_amount${i}`] ?? 0;
              inv.push(
                formatNumberWithCommas(
                  typeof savedInv === 'number' && !Number.isNaN(savedInv)
                    ? savedInv
                    : (buyerAmt + sellerAmt)
                )
              );
            }
          }
          enforceComputedReadOnly();
        }
        if (names.length === 0) { names.push('-'); buyerP.push('-'); sellerP.push('-'); inv.push('-'); }

        const addr = buildAddress(row);
        const areaDisp = formatArea1(row.area_py);

        const tr = document.createElement('tr');
        tr.classList.add('cursor-pointer', 'hover:bg-gray-100');

        const tdHTML = (html) => {
          const td = document.createElement('td');
          td.className = 'border px-2 py-1';
          td.innerHTML = html ?? '';
          return td;
        };
        const tdMulti = (text) => {
          const td = document.createElement('td');
          td.className = 'border px-2 py-1 whitespace-pre-line';
          td.textContent = text ?? '';
          return td;
        };

        tr.appendChild(tdHTML(buildListingTitle(row)));
        tr.appendChild(tdHTML(addr));
        tr.appendChild(tdHTML(row.deal_type ?? ''));
        tr.appendChild(tdHTML(buildPriceBlock(row)));
        tr.appendChild(tdHTML(areaDisp));
        tr.appendChild(tdHTML(buildDateBlock(row)));
        tr.appendChild(tdHTML(formatNumberWithCommas(row.buyer_fee) ?? ''));
        tr.appendChild(tdHTML(formatNumberWithCommas(row.buyer_tax) ?? ''));
        tr.appendChild(tdHTML(formatYYMMDD(row.buyer_tax_date)));
        tr.appendChild(tdHTML(formatNumberWithCommas(row.seller_fee) ?? ''));
        tr.appendChild(tdHTML(formatNumberWithCommas(row.seller_tax) ?? ''));
        tr.appendChild(tdHTML(formatYYMMDD(row.seller_tax_date)));
        tr.appendChild(tdHTML(formatNumberWithCommas(row.expense) ?? ''));
        tr.appendChild(tdMulti(names.join('\n')));
        tr.appendChild(tdMulti(buyerP.join('\n')));
        tr.appendChild(tdMulti(sellerP.join('\n')));
        tr.appendChild(tdMulti(inv.join('\n')));

        applyRowStatusColor(tr, row);

        tr.addEventListener('click', () => {
          currentPerformanceId = row.id;
          isDownPaymentAutoFilled = false;
          openDrawer();
          fillFormWithPerformance(row);
          fillAllocations(pa || null);
          updateHighlight();
          const locked = !!row.status;
          setFormEditable(!locked);
        });

        window.triggerAllocationRecalc?.();
        tbody.appendChild(tr);
      });
      // [ADD] 합계 갱신
      updateSalesTotal();
      window.__updateSalesTotalFromIndex?.();
    }

    // [ADD] 원본 데이터 보관 + 렌더러 등록
    setPerformanceRows(data || []);
    registerPerformanceRenderer(renderPerformanceTable);

    // 🔥 잔금일 기준 오름차순 정렬 추가
    data.sort((a, b) => {
      const da = a.balance_date ? new Date(a.balance_date) : new Date(0);
      const db = b.balance_date ? new Date(b.balance_date) : new Date(0);
      return da - db;   // 오름차순
    });

    // [초기 렌더]
    renderPerformanceTable(data || []);
    // [ADD] 첫 화면 합계 갱신
    updateSalesTotal();
    window.__updateSalesTotalFromIndex?.();

    // [ADD] 필터에서 사용할 원본/렌더러 보관
    window.__PERF_ROWS   = data || [];
    window.__RENDER_PERF = renderPerformanceTable;

    // === [ADD] 날짜 필터: 버튼 핸들러 + 렌더 ===
    (function wireSalesDateFilter() {
      // 한 번만 바인딩되도록 가드
      if (window.__salesFilterWired) return;
      window.__salesFilterWired = true;

      const $ = (id) => document.getElementById(id);
      const startEl = $('filter-start-date');
      const endEl   = $('filter-end-date');
      const fieldEl = $('filter-date-field');
      const applyEl = $('apply-filter');
      const resetEl = $('reset-filter');

      function parseYMD(s) {
        // 'YYYY-MM-DD' → Date(로컬 00:00)
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s||'').trim());
        if (!m) return null;
        return new Date(+m[1], +m[2]-1, +m[3]);
      }

      function inRangeStr(ymdStr, startStr, endStr) {
        if (!ymdStr) return false; // 날짜 없는 행은 제외
        const d = parseYMD(ymdStr);
        if (!d) return false;

        const start = parseYMD(startStr);
        const end   = parseYMD(endStr);

        // 시작/종료 중 비어있는 값은 열린구간으로 처리
        if (start && d < start) return false;
        if (end) {
          // 종료일 포함(inclusive) 처리: 23:59:59 대신 날짜 비교로 처리
          const endIncl = new Date(end.getFullYear(), end.getMonth(), end.getDate());
          if (d > endIncl) return false;
        }
        return true;
      }

      function applyFilter() {
        // 날짜는 readDateFilter()로 loadPerformanceTable 내부에서 직접 반영됨
        Promise.resolve(loadPerformanceTable()).then(() => {
          window.__updateSalesTotalFromIndex?.();
          window.updateDepositVisibility?.();
        });
      }

      function resetFilter() {
        const now = new Date();
        const first = new Date(now.getFullYear(), now.getMonth(), 1);
        const last  = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        const toYMD = (d) => {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${day}`;
        };

        // 기준을 '잔금일'로 고정
        if (fieldEl) fieldEl.value = 'balance_date';
        // 이번 달 1일 ~ 말일로 설정
        if (startEl) startEl.value = toYMD(first);
        if (endEl)   endEl.value   = toYMD(last);

        // 바로 적용
        // (렌더 → 합계 갱신까지)
        applyFilter();
      }

      applyEl?.addEventListener('click', applyFilter);
      resetEl?.addEventListener('click', resetFilter);

      // 기준(계약일/잔금일) 바뀌면 즉시 재적용
      fieldEl?.addEventListener('change', applyFilter);
    })();        
  } catch (e) {
    console.error(e);
    showToastGreenRed('예상치 못한 오류');
  }
}

// 페이지 로드 시 자동 실행 (기본: '내가 관여한 매출'로 필터)
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const me = await getMyAuthorityAndStaffId(); // { staffId, authority, ... }
    if (me?.staffId) {
      // 어떤 권한이든 '내 스태프ID'로 먼저 필터링해서 내 관여 매출만 보이게
      window.__selectedStaffId = me.staffId;
    }
  } catch (e) {
    console.warn('기본 직원 선택 실패:', e?.message);
  }
  await loadPerformanceTable();
  window.updateDepositVisibility?.();

  // (선택) 좌측 목록에서 내 이름 하이라이트
  try {
    const container = document.getElementById('staff-list');
    if (container && window.__selectedStaffId != null) {
      container.querySelectorAll('.name-item').forEach(el => {
        if (String(el.dataset.staffId) === String(window.__selectedStaffId) && el.dataset.disabled !== '1') {
          el.classList.add('bg-yellow-200');
        } else {
          el.classList.remove('bg-yellow-200');
        }
      });
    }
  } catch {}
});


// 초기화: 페이지 로드 후
document.addEventListener("DOMContentLoaded", async () => {
  // 1) 자동폭 입력 & 분배 아이템 생성
  document.querySelectorAll('input[data-autowidth]').forEach(el => autosizeInputByCh(el));
  const container = document.querySelector(".grid.grid-cols-4");
  for (let i = 1; i <= 4; i++) {
    const item = createAllocationItem(i);
    container.appendChild(item);
  }

  // 2) 내 소속 우선 직원 옵션 채우기
  const myAff = await getMyAffiliation();
  await populateAllStaffSelects(myAff);
  await populateAffiliationSelect();  // ← 추가: 담당 지점 셀렉트 옵션 채우기

  // 3) 헬퍼: 분배칸(클로징/매물확보 %) 재계산 트리거
  function triggerAllocationRecalc() {
    document.querySelectorAll(".buyer-weight, .seller-weight").forEach(input => {
      // createAllocationItem() 내부의 'input' 리스너가 계산을 수행함
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  // ✅ 전역에서 쓸 수 있게 노출
  window.triggerAllocationRecalc = triggerAllocationRecalc;

  // 4) (클로징/매물) 매출 값이 바뀌면 → 분배칸 다시 계산
  ["f_buyer_performance", "f_seller_performance"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) {
      console.warn(`⚠️ ${id} 엘리먼트를 찾을 수 없습니다.`);
      return;
    }
    el.addEventListener("input", triggerAllocationRecalc);
    el.addEventListener("change", triggerAllocationRecalc);
  });

  // 5) 수수료가 바뀌면 → (클로징/매물) 매출 재산출 → 분배칸 다시 계산
  ["f_buyer_fee", "f_seller_fee", "f_expense"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      const handler = () => {
        recalcPerformanceFromFees();   // 클로징/매물 매출 갱신 (비용 차감 포함)
        triggerAllocationRecalc();     // 직원별 기여 매출 갱신
        formatIdsWithCommas(['f_buyer_performance','f_seller_performance']);
      };
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    }
  });

  // 6) 물건분(분배율) 바뀌어도 동일하게 연쇄 갱신
  const distEl = document.getElementById('f_seller_distribution_rate');
  if (distEl) {
    const handler = () => {
      recalcPerformanceFromFees();     // 분배율 변화 반영
      triggerAllocationRecalc();       // 직원별 기여 매출 갱신
      formatIdsWithCommas(['f_buyer_performance','f_seller_performance']);
    };
    distEl.addEventListener("input", handler);
    distEl.addEventListener("change", handler);
  }

  // 7) 초기 1회 동기화
  triggerAllocationRecalc();
  formatIdsWithCommas(['f_buyer_performance','f_seller_performance']);
});


// 페이지 로드 후 바로 활성화
document.addEventListener('DOMContentLoaded', () => {
  enableAutoGrowTextArea(document.getElementById('f_special_contract'));
});

// 매출등록) 거래유형에 따라 매매가 / 보증금,월세 빨갛게 표시
document.addEventListener("DOMContentLoaded", () => {
  updateHighlight();
  document.getElementById("f_deal_type")?.addEventListener("change", updateHighlight);

  [
    "f_deposit_price", "f_down_payment",
    "f_interim_payment1", "f_interim_payment2", "f_interim_payment3",
    "f_buyer_performance", "f_seller_performance"
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", () => {
        const isDeposit = id === "f_deposit_price";
        calculateDownPaymentAndBalance({ forceDownPaymentUpdate: isDeposit });
      });
      el.addEventListener("change", () => {
        const isDeposit = id === "f_deposit_price";
        calculateDownPaymentAndBalance({ forceDownPaymentUpdate: isDeposit });
      });
    }
  });
});

// 드로어 열릴 때(보이기 시작할 때) 다시 한 번 맞추면 깔끔
const _openDrawerOrig = openDrawer;
openDrawer = function () {
  _openDrawerOrig();
  requestAnimationFrame(() => {
    const ta = document.getElementById('f_special_contract');
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    }
    enforceComputedReadOnly();
  });
};

// ===== 패널 열고 닫기 =====
const drawer = document.getElementById('sales-drawer');
const overlay = document.getElementById('sales-overlay');

// [CHANGE] 매출등록 버튼 클릭 시 무조건 폼 초기화 후 열기
document.getElementById('open-sales-drawer')?.addEventListener('click', () => {
  currentPerformanceId = null;
  resetForm();
  openDrawer();
  setFormEditable(true); // ← [ADD] 신규 작성은 항상 편집 가능
  // 담당 지점 초기화(옵션 목록은 openDrawer에서 populateAffiliationSelect가 채움)
  const affEl = document.getElementById('f_affiliation');
  if (affEl) affEl.value = '';
});

document.getElementById('close-sales-drawer')?.addEventListener('click', closeDrawer);
overlay?.addEventListener('click', closeDrawer);

// === 저장 ===
document.getElementById('save-sales')?.addEventListener('click', async () => {
  if (__saving) return;
  __saving = true;
  try {
    if (!window.supabase) { showToastGreenRed('Supabase 클라이언트를 찾을 수 없습니다.'); return; }

    // 직원 권한은 분배율 30 고정 (단, 수수료가 비어 있을 때만 자동 계산)
    const distEl = document.getElementById('f_seller_distribution_rate');
    if (window.__isStaff && distEl) {
      distEl.value = 30;

      // 현재 입력값 확인 (콤마/문자 제거 → 숫자 or null)
      const buyerFeeNow  = numOrNull(document.getElementById('f_buyer_fee')?.value);
      const sellerFeeNow = numOrNull(document.getElementById('f_seller_fee')?.value);

      // 둘 다 비어 있을 때만 자동계산 수행
      if (buyerFeeNow == null && sellerFeeNow == null && typeof calculateFees === 'function') {
        calculateFees();
      }
    }

    // (1) 가중치 합 검사
    if (!validateTotalWeight()) {
      const btn = document.getElementById('save-sales');
      btn?.classList.add('animate-bounce');
      setTimeout(() => btn?.classList.remove('animate-bounce'), 600);
      return;
    }

    // (2) 계산 최신화 (수수료→매출, 계약금/잔금)
    try {
      recalcPerformanceFromFees();
      calculateDownPaymentAndBalance();
    } catch {}

    // (3) 필수값 검사
    const get     = (id) => document.getElementById(id);
    const textVal = (id) => (get(id)?.value ?? '').trim();
    const numVal  = (id) => numOrNull(get(id)?.value);
    const fail = (id, msg) => { 
      showToastGreenRed(msg);
      const el = get(id);
      if (el) { el.focus(); el.classList.add('ring-2','ring-red-400'); setTimeout(()=>el.classList.remove('ring-2','ring-red-400'),1200); }
      return true;
    };

    // 3-1) 공통 문자열
    const textRequired = [
      ['f_listing_title',  '매물명'],
      ['f_province',       '시/도'],
      ['f_city',           '시/군/구'],
      ['f_district',       '읍/면/동'],
      ['f_detail_address', '번지'],
      ['f_deal_type',      '거래유형'],
      ['f_contract_date',  '계약일'],
      ['f_balance_date',   '잔금일'],
      ['f_affiliation',    '담당 지점'],
    ];
    for (const [id, label] of textRequired) {
      if (!textVal(id)) { if (fail(id, `${label}을(를) 입력하세요.`)) return; }
    }

    // 3-2) 거래유형별 금액
    const dealType = textVal('f_deal_type');
    if (dealType === '매매') {
      if (numVal('f_sale_price') == null) { if (fail('f_sale_price', '매매가를 입력하세요.')) return; }
    } else if (dealType === '월세') {
      if (numVal('f_deposit_price') == null) { if (fail('f_deposit_price', '보증금을 입력하세요.')) return; }
      if (numVal('f_monthly_rent') == null)  { if (fail('f_monthly_rent',  '월세를 입력하세요.')) return; }
    }

    // 3-3) 숫자 필수(계약금/잔금/수수료/매출)
    const numericRequired = [
      ['f_down_payment',        '계약금'],
      ['f_balance',             '잔금'],
      ['f_buyer_fee',           '매수인 수수료'],
      ['f_seller_fee',          '매도인 수수료'],
      ['f_buyer_performance',   '클로징 매출'],
      ['f_seller_performance',  '물건 매출'],
    ];
    for (const [id, label] of numericRequired) {
      if (numVal(id) == null) { if (fail(id, `${label}을(를) 입력하세요.`)) return; }
    }

    // (4) 페이로드 수집 + 담당 지점 강제 보정
    const payload = collectPerformancePayload();
    {
      const affEl = document.getElementById('f_affiliation');
      const raw = typeof payload.affiliation === 'string'
        ? payload.affiliation
        : (affEl?.value ?? '');
      const v = String(raw || '').trim();
      payload.affiliation = v === '' ? null : v;

      // ❗(필요시 해제) 만약 실제 컬럼명이 다르면 아래 매핑을 사용하세요.
      // payload.branch_affiliation = payload.affiliation; delete payload.affiliation;
    }

    // (5) 저장/수정
    let perfId = currentPerformanceId;

    if (perfId) {
      // UPDATE (반환값으로 affiliation 확인)
      const { data: upd, error: upErr } = await window.supabase
        .from('performance')
        .update(payload)
        .eq('id', perfId)
        .select('id, affiliation');   // ✅ 반영 확인
      if (upErr) { showToastGreenRed('매출 수정 실패: ' + upErr.message); return; }
      console.debug('[performance UPDATE] id=', perfId, 'affiliation=', upd?.[0]?.affiliation ?? null);

      const allocRow = collectAllocationPayloadRow(perfId);
      const anySelected = [1,2,3,4].some(i => !!allocRow[`staff_id${i}`]);
      if (!anySelected) {
        const { error: delErr } = await window.supabase
          .from('performance_allocations')
          .delete()
          .eq('performance_id', perfId);
        if (delErr) { showToastGreenRed('분배 삭제 실패: ' + delErr.message); return; }
      } else {
        const { error: upsertErr } = await window.supabase
          .from('performance_allocations')
          .upsert(allocRow, { onConflict: 'performance_id', ignoreDuplicates: false });
        if (upsertErr) { showToastGreenRed('분배 저장 실패: ' + upsertErr.message); return; }
      }
      showToastGreenRed('수정 완료!', { ok: true });

    } else {
      // INSERT (반환값으로 affiliation 확인)
      const { data: perfInsert, error: perfErr } = await window.supabase
        .from('performance')
        .insert(payload)
        .select('id, affiliation')     // ✅ 반영 확인
        .single();
      if (perfErr) { showToastGreenRed('매출 저장 실패: ' + perfErr.message); return; }

      perfId = perfInsert?.id;
      console.debug('[performance INSERT] id=', perfId, 'affiliation=', perfInsert?.affiliation ?? null);
      if (!perfId) { showToastGreenRed('생성된 매출 ID를 확인할 수 없습니다.'); return; }

      const allocRow = collectAllocationPayloadRow(perfId);
      const anySelected = [1,2,3,4].some(i => !!allocRow[`staff_id${i}`]);
      if (anySelected) {
        const { error: upsertErr } = await window.supabase
          .from('performance_allocations')
          .upsert(allocRow, { onConflict: 'performance_id', ignoreDuplicates: false });
        if (upsertErr) {
          await window.supabase.from('performance').delete().eq('id', perfId); // 롤백
          showToastGreenRed('분배 저장 실패. 작업이 취소되었습니다: ' + upsertErr.message);
          return;
        }
      }
      showToastGreenRed('저장 완료!', { ok: true });
    }

    

    currentPerformanceId = null;
    resetForm();
    closeDrawer();
    loadPerformanceTable();
  } catch (err) {
    console.error(err);
    showToastGreenRed('예상치 못한 오류가 발생했습니다.');
  } finally {
    __saving = false;
  }
});

// ===== window.supabase 노출 (type="module" 블록에서 만든 인스턴스 공유) =====
// 위쪽 module 스크립트가 끝난 뒤 실행되는 이 블록에서 접근 가능하도록 트릭:
(function exposeSupabase() {
  try {
    // 전역 window 객체에 이미 있으면 패스
    if (!window.supabase && typeof window.createClient === 'undefined') {
      // 모듈 스코프에 있으나 전역으로 안 보일 수 있어서, 이미 만들어진 인스턴스를 다시 참조
      // 현재 파일에서는 module 블록 내 변수명 'supabase' 를 직접 접근할 수 없으므로,
      // 간단한 방법: module 블록 하단에 window.supabase = supabase; 한 줄을 추가하는 편이 가장 안전.
    }
  } catch {}
})();

// ===== f_manager에 select box 구성 =====
document.addEventListener("supabase-ready", async () => {
  const supabase = window.supabase;

  const { data: sessionRes } = await supabase.auth.getSession();
  const user = sessionRes?.session?.user;

  if (!user?.id) return;

  // 로그인 유저 정보
  const { data: myProfile, error: myErr } = await supabase
    .from("staff_profiles")
    .select("affiliation")
    .eq("user_id", user.id)
    .maybeSingle();

  if (myErr || !myProfile) {
    console.error("로그인 유저 소속 조회 실패", myErr);
    return;
  }

  const myAffiliation = myProfile.affiliation;

  // 모든 재직자 불러오기
  const { data: allStaff, error } = await supabase
    .from("staff_profiles")
    .select("id, name, affiliation")
    .is("leave_date", null)
    .order("affiliation", { ascending: true });

  if (error || !allStaff) {
    console.error("직원 목록 불러오기 실패", error);
    return;
  }

  // 소속 기준 분류
  const grouped = {};
  for (const row of allStaff) {
    const { id, name, affiliation } = row;
    if (!grouped[affiliation]) grouped[affiliation] = [];
    grouped[affiliation].push({ id, name });
  }

  const select = document.getElementById("select_staff1");
  if (!select) return;
  select.innerHTML = `<option value="">-- 직원 선택 --</option>`; // 초기화


  // 1. 본인 소속 먼저 추가
  if (grouped[myAffiliation]) {
    const optGroup = document.createElement("optgroup");
    optGroup.label = myAffiliation;
    grouped[myAffiliation].forEach(({ id, name }) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = name;
      optGroup.appendChild(opt);
    });
    select.appendChild(optGroup);
    delete grouped[myAffiliation]; // 중복 방지
  }

  // 2. 나머지 소속 추가 (정렬 포함)
  Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b, "ko"))
    .forEach(([aff, list]) => {
      const optGroup = document.createElement("optgroup");
      optGroup.label = aff;
      list.forEach(({ id, name }) => {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = name;
        optGroup.appendChild(opt);
      });
      select.appendChild(optGroup);
    });
});

// 매물번호 입력시 정보 자동으로 채우기
// ====== 매물번호로 자동 채우기 (public_baikuk_view 버전) ======

// 1) 폼 필드 매핑 (view에 있는 컬럼만)
const FIELD_MAP = {
  deal_type:       'f_deal_type',
  listing_title:   'f_listing_title',
  province:        'f_province',
  city:            'f_city',
  district:        'f_district',
  deposit_price:   'f_deposit_price',
  monthly_rent:    'f_monthly_rent',
  sale_price:      'f_sale_price',
  area_py:         'f_area_py',
};

// 2) 값 채우기 헬퍼 - select에 넣을 때 trim
function setInputValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const vRaw = (value == null) ? '' : String(value);
  const v = vRaw.trim();

  if (el.tagName === 'SELECT') {
    const exists = Array.from(el.options).some(o => o.value === v);
    if (v && !exists) {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = v;
      el.appendChild(opt);
    }
    el.value = v;

    // ✅ 거래유형이 프로그램적으로 바뀐 경우, 이벤트 트리거 + 즉시 반영
    if (id === 'f_deal_type') {
      el.dispatchEvent(new Event('change', { bubbles: true })); // 바인딩된 핸들러 호출
      if (typeof updateHighlight === 'function') updateHighlight(); // 라벨 즉시 갱신
      if (typeof calculateFees === 'function') calculateFees();     // 수수료/매출 즉시 갱신
      if (typeof calculateDownPaymentAndBalance === 'function') calculateDownPaymentAndBalance();
    }
  } else {
    el.value = vRaw;
  }
}

const MONEY_FIELD_IDS = new Set([
  "f_sale_price","f_deposit_price","f_monthly_rent","f_premium_price",
  "f_buyer_fee","f_buyer_tax","f_seller_fee","f_seller_tax",
  "f_buyer_performance","f_seller_performance","f_expense"
]);

function fillFormFromRow(row) {
  Object.entries(FIELD_MAP).forEach(([col, inputId]) => {
    let val = row?.[col] ?? '';

    // 10,000 배 변환 (만원 → 원)
    if (["deposit_price","monthly_rent","sale_price","premium_price"].includes(col)) {
      if (val != null && val !== '') val = Number(val) * 10000;
    }

    setInputValue(inputId, val);

    // 💡 금액 필드는 바로 콤마로 보이도록
    if (MONEY_FIELD_IDS.has(inputId)) {
      const el = document.getElementById(inputId);
      if (el) el.value = formatNumberWithCommas(el.value);
    }
  });
}

// 3) 조회 함수
async function fetchListingAndFill(listingId) {
  try { await waitForSupabase(); } 
  catch { showToastGreenRed('Supabase 초기화 지연'); return; }

  const n = intOrNull(listingId);
  if (n === null) return; // 숫자 아닐 때 종료

  const selectCols = Object.keys(FIELD_MAP).join(', ');

  // 1) 지정 컬럼으로 조회
  let { data, error } = await window.supabase
    .from('public_baikuk_view')
    .select(selectCols)
    .eq('listing_id', n)
    .maybeSingle();

  if (error) {
    const msg = (error.message || '').toLowerCase();

    // 컬럼 문제 → 전체(*) 재조회 후 교차 매핑
    if (msg.includes('does not exist') || msg.includes('column')) {
      const retry = await window.supabase
        .from('public_baikuk_view')
        .select('*')
        .eq('listing_id', n)
        .maybeSingle();

      if (retry.error) {
        showToastGreenRed('매물 조회 실패: ' + (retry.error.message || ''));
        return;
      }
      if (!retry.data) { showToastGreenRed('해당 매물번호를 찾을 수 없습니다.'); return; }

      const row = retry.data;
      fillFormFromRow(row);

      // === [ADD] 계약금 자동 계산: 보증금의 10% ===
      (() => {
        const deposit = numOrNull(document.getElementById('f_deposit_price')?.value);
        const dpEl = document.getElementById('f_down_payment');
        if (dpEl) {
          if (typeof deposit === 'number' && deposit > 0) {
            const dp = Math.round(deposit * 0.10); // 10%
            dpEl.value = formatNumberWithCommas(dp);
            // (옵션) 자동채움 플래그 사용 중이면 켜두기
            try { isDownPaymentAutoFilled = true; } catch {}
          } else {
            dpEl.value = '';
          }
        }
      })();

      calculateFees();
      calculateDownPaymentAndBalance({ forceDownPaymentUpdate: true });

      // 선택값과 무관하게 드롭다운을 강제로 맞춤
      initSalesLocationSelects({
        province: row.province, city: row.city, district: row.district
      });
      showToastGreenRed('매물 정보 자동 채움 완료(교차 매핑)', { ok: true });
      return;
    }

    if (msg.includes('relation') && msg.includes('does not exist')) {
      showToastGreenRed('뷰를 찾을 수 없습니다. public 스키마의 public_baikuk_view 확인 필요');
    }
    return;
  }

  // 2) 정상 채움
  fillFormFromRow(data);

  // === [ADD] 계약금 자동 계산: 보증금의 10% ===
  (() => {
    const deposit = numOrNull(document.getElementById('f_deposit_price')?.value);
    const dpEl = document.getElementById('f_down_payment');
    if (dpEl) {
      if (typeof deposit === 'number' && deposit > 0) {
        const dp = Math.round(deposit * 0.10); // 10%
        dpEl.value = formatNumberWithCommas(dp);
        // (옵션) 자동채움 플래그 사용 중이면 켜두기
        try { isDownPaymentAutoFilled = true; } catch {}
      } else {
        dpEl.value = '';
      }
    }
  })();

  calculateFees();
  calculateDownPaymentAndBalance({ forceDownPaymentUpdate: true });

  // 선택값과 상관없이 드롭다운을 해당 값으로 재구성+선택
  initSalesLocationSelects({
    province: data.province, city: data.city, district: data.district
  });

  // ✅ 거래유형에 맞춰 라벨/색 즉시 갱신
  if (typeof updateHighlight === "function") updateHighlight();
  showToastGreenRed('매물 정보 자동 채움 완료', { ok: true });
}

// 4) 매물번호 입력 필드 바인딩 (blur 시 1회성 조회)
(function bindListingIdOnBlur() {
  const listingIdEl = document.getElementById('f_listing_id');
  if (!listingIdEl) return;

  let lastFetched = null; // 마지막으로 조회한 값 저장

  listingIdEl.addEventListener('blur', () => {
    const val = (listingIdEl.value || '').trim();
    if (!val) return;

    // 이전에 같은 값으로 조회했다면 패스
    if (val === lastFetched) return;

    fetchListingAndFill(val);
    lastFetched = val;
  });

  // 선택: 드로어 닫힐 때 lastFetched 초기화
  const drawer = document.getElementById('sales-drawer');
  if (drawer) {
    drawer.addEventListener('transitionend', () => {
      if (drawer.classList.contains('translate-x-full')) {
        lastFetched = null;
      }
    });
  }
})();   

// 이벤트 바인딩 (값이 변할 때마다 자동계산)
const calcFeesAndTrigger = () => {
  calculateFees();               // 수수료 → (클로징/매물)매출 갱신
  window.triggerAllocationRecalc?.(); // 직원별 기여매출까지 갱신
};

["f_deal_type","f_sale_price","f_deposit_price","f_monthly_rent"].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("input",  calcFeesAndTrigger);
    el.addEventListener("change", calcFeesAndTrigger);
  }
});

const distEl2 = document.getElementById("f_seller_distribution_rate");
distEl2?.addEventListener("input",  calcFeesAndTrigger);
distEl2?.addEventListener("change", calcFeesAndTrigger);

// ===== 포맷 적용할 필드들 =====
[
  "f_sale_price",
  "f_deposit_price",
  "f_monthly_rent",
  "f_premium_price",
  "f_down_payment",
  "f_interim_payment1",
  "f_interim_payment2",
  "f_interim_payment3", 
  "f_balance",
  "f_buyer_fee",
  "f_buyer_tax",
  "f_seller_fee",
  "f_seller_tax",
  "f_buyer_performance",
  "f_seller_performance",
  "f_expense"
].forEach(attachCommaFormatter);

// 매출내역 수정창에 띄우기
function setField(id, v, {comma=false} = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  if (comma) {
    el.value = formatNumberWithCommas(v ?? '');
  } else {
    el.value = (v ?? '') === null ? '' : String(v ?? '');
  }
  // select의 경우 값이 없으면 그대로(옵션은 init에서 채워짐)
}

function fillFormWithPerformance(row) {
  // 기본 정보
  setField('f_listing_id', row.listing_id);
  setField('f_listing_title', row.listing_title);
  // 지역 선택은 드롭다운 의존 → 값을 먼저 저장해두고 initSalesLocationSelects로 세팅
  initSalesLocationSelects({
    province: row.province, city: row.city, district: row.district
  });
  setField('f_detail_address', row.detail_address);

  // 금액/면적/거래유형
  setField('f_deal_type', row.deal_type);
  // toLocale 콤마 표시
  setField('f_sale_price', row.sale_price, {comma:true});
  setField('f_deposit_price', row.deposit_price, {comma:true});
  setField('f_monthly_rent', row.monthly_rent, {comma:true});
  setField('f_premium_price', row.premium_price, {comma:true});
  setField('f_area_py', row.area_py);

  // 일정
  setField('f_down_payment', row.down_payment, {comma:true});
  setField('f_balance', row.balance, {comma:true});
  setField('f_contract_date', row.contract_date);
  setField('f_balance_date',  row.balance_date);
  setField('f_interim_payment1', row.interim_payment1, {comma:true});
  setField('f_interim_payment1_date', row.interim_payment1_date);
  setField('f_interim_payment2', row.interim_payment2, {comma:true});
  setField('f_interim_payment2_date', row.interim_payment2_date);
  setField('f_interim_payment3', row.interim_payment3, {comma:true});
  setField('f_interim_payment3_date', row.interim_payment3_date);


  // 수수료/세금/매출
  setField('f_buyer_fee', row.buyer_fee, {comma:true});
  setField('f_buyer_tax', row.buyer_tax, {comma:true});
  setField('f_buyer_tax_date', row.buyer_tax_date);
  setField('f_seller_fee', row.seller_fee, {comma:true});
  setField('f_seller_tax', row.seller_tax, {comma:true});
  setField('f_seller_tax_date', row.seller_tax_date);
  setField('f_expense', row.expense, {comma:true});

  // 매출 자동계산 필드(표시만)
  // 분배율은 현재 정책(직원은 30 고정)이 있으므로 값 그대로 두거나 필요 시 조정
  recalcPerformanceFromFees();

  // 담당 지점: 옵션 보장 후 선택
  (async () => {
    try {
      // 옵션이 아직 비었을 수도 있으니 한 번 더 보장
      await populateAffiliationSelect?.();
    } catch {}
    const affEl = document.getElementById('f_affiliation');
    if (affEl) {
      const v = (row.affiliation ?? '').trim();
      if (v && ![...affEl.options].some(o => o.value === v)) {
        const opt = document.createElement('option');
        opt.value = v; opt.textContent = v;
        affEl.appendChild(opt);
      }
      affEl.value = v;
    }
  })();

  // 메모
  setField('f_special_contract', row.special_contract);    
}

// ✅ 분배 드로어 채우기: staff/weights + 합계 매출(involvement_sales) 표시
function fillAllocations(pa) {
  for (let i = 1; i <= 4; i++) {
    const select = document.getElementById(`select_staff${i}`);
    const buyerInput = document.getElementById(`f_buyer_weight${i}`);
    const sellerInput = document.getElementById(`f_seller_weight${i}`);
    const sumInput = document.getElementById(`f_involvement_sales${i}`);

    if (!select || !buyerInput || !sellerInput || !sumInput) continue;

    const sid = pa?.[`staff_id${i}`] ?? '';
    const bw  = (pa?.[`buyer_weight${i}`] ?? 0) * 100;  // 0~1 -> %
    const sw  = (pa?.[`seller_weight${i}`] ?? 0) * 100; // 0~1 -> %

    select.value = sid || '';
    buyerInput.value = bw || '';
    sellerInput.value = sw || '';

    const savedSum = pa?.[`involvement_sales${i}`];
    if (typeof savedSum === 'number' && !Number.isNaN(savedSum)) {
      sumInput.value = formatNumberWithCommas(Math.round(savedSum));
    } else {
      // 저장값 없으면 현재 가중치로 즉시 계산해서 표시(UX 차원)
      const buyerPerf  = numOrNull(document.getElementById('f_buyer_performance')?.value) || 0;
      const sellerPerf = numOrNull(document.getElementById('f_seller_performance')?.value) || 0;
      const result = (buyerPerf * (bw * 0.01)) + (sellerPerf * (sw * 0.01));
      sumInput.value = formatNumberWithCommas(Math.round(result));
    }
  }

  // 가중치 변경 리스너가 이미 있어서, 아래 트리거로 동기화
  window.triggerAllocationRecalc?.();
}
// [ADD] 날짜 입력칸에서 Enter 누르면 필터 적용
document.addEventListener('DOMContentLoaded', () => {
  const start = document.getElementById('filter-start-date');
  const end   = document.getElementById('filter-end-date');
  const apply = document.getElementById('apply-filter');
  [start, end].forEach(el => {
    el?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') apply?.click();
    });
  });
});

document.getElementById('last-month-filter')?.addEventListener('click', () => {
  const fieldEl = document.getElementById('filter-date-field');
  const startEl = document.getElementById('filter-start-date');
  const endEl   = document.getElementById('filter-end-date');

  // 지난달 계산
  const now = new Date();
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month = now.getMonth() === 0 ? 11 : now.getMonth() - 1;

  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);

  const toYMD = d => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };

  // 기존 invalid 값 제거 (★ 핵심)
  startEl.value = '';
  endEl.value = '';

  // 정상 값 입력
  fieldEl.value = "balance_date";
  startEl.value = toYMD(firstDay);
  endEl.value   = toYMD(lastDay);

  // 테이블 새로고침
  Promise.resolve(loadPerformanceTable()).then(() => {
    window.__updateSalesTotalFromIndex?.();
    window.updateDepositVisibility?.();
  });
});

document.getElementById('two-months-filter')?.addEventListener('click', () => {
  const fieldEl = document.getElementById('filter-date-field');
  const startEl = document.getElementById('filter-start-date');
  const endEl   = document.getElementById('filter-end-date');

  // === 2달 전 계산 ===
  const now = new Date();
  // 지난달 = currentMonth - 1
  // 2달전 = currentMonth - 2
  // JS가 자동으로 연/월 보정해줌
  const target = new Date(now.getFullYear(), now.getMonth() - 2, 1);

  // 2달전의 첫날
  const firstDay = new Date(target.getFullYear(), target.getMonth(), 1);
  // 2달전의 마지막 날
  const lastDay  = new Date(target.getFullYear(), target.getMonth() + 1, 0);

  // YYYY-MM-DD 포맷
  const toYMD = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
  };

  // invalid 값 초기화 (지난달 버튼과 동일)
  startEl.value = '';
  endEl.value   = '';

  // 잔금일 기준 강제
  fieldEl.value = "balance_date";
  startEl.value = toYMD(firstDay);
  endEl.value   = toYMD(lastDay);

  // 테이블 새로고침
  Promise.resolve(loadPerformanceTable()).then(() => {
    window.__updateSalesTotalFromIndex?.();
    window.updateDepositVisibility?.();
  });
});
