// /admin/cost_management/cost_management.js

import { client as supabase } from '../../modules/core/supabase.js';
import { showToastGreenRed } from '../../modules/ui/toast.js';

const $ = (s, d=document) => d.querySelector(s);

// 권한/소속 전역
let __MY_ROLE = '직원';      // '직원' | '지점장' | '관리자'
let __MY_AFFILIATION = null; // 로그인 사용자의 기본 지점

// 숫자만 남기는 헬퍼
function toNumberKR(v) {
  return Number(String(v ?? '0').replace(/[^\d.-]/g, '')) || 0;
}
// yyyy-mm-dd 포매터 (KST 기준 오늘)
function todayKST() {
  const now = new Date();
  // 브라우저가 KST면 그대로, 아니면 타임존 보정 필요. 여기서는 로컬 날짜를 사용.
  // 한국 서비스 기준이면 대부분 KST 브라우저/서버일 가능성이 높아 간단화.
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth()+1).padStart(2,'0');
  const dd = String(now.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

// 1) 로그인 체크 및 권한/지점 확인 (미로그인 → listings로 이동)
async function resolveMyAuthority() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      window.location.href = '/admin/listings/';
      return false;
    }

    const { data: rows, error } = await supabase
      .from('staff_profiles')
      .select('authority, affiliation')
      .eq('user_id', user.id)
      .is('leave_date', null);

    if (error) throw error;

    __MY_ROLE = '직원';
    __MY_AFFILIATION = null;

    for (const r of (rows || [])) {
      if (r.authority === '관리자') {
        __MY_ROLE = '관리자';
        if (!__MY_AFFILIATION && r.affiliation) __MY_AFFILIATION = r.affiliation;
      } else if (r.authority === '지점장' && __MY_ROLE !== '관리자') {
        __MY_ROLE = '지점장';
        __MY_AFFILIATION = r.affiliation || __MY_AFFILIATION;
      } else if (r.authority === '직원' && !__MY_AFFILIATION) {
        __MY_AFFILIATION = r.affiliation || __MY_AFFILIATION;
      }
    }

    // 소속 없으면 접근 제한 (listings로 이동)
    if (!__MY_AFFILIATION) {
      window.location.href = '/admin/listings/';
      return false;
    }
    return true;

  } catch (e) {
    console.error('권한 조회 실패:', e);
    showToastGreenRed?.('권한 확인 실패');
    window.location.href = '/admin/listings/';
    return false;
  }
}

// 2) 지점 목록 불러오기 → select 옵션 구성
async function loadBranchesIntoSelect(selectEl) {
  if (!selectEl) return;
  try {
    const { data, error } = await supabase
      .from('branch_info')
      .select('affiliation')
      .order('affiliation', { ascending: true });
    if (error) throw error;

    selectEl.innerHTML = '';
    for (const row of (data || [])) {
      if (!row?.affiliation) continue;
      const opt = document.createElement('option');
      opt.value = row.affiliation;
      opt.textContent = row.affiliation;
      selectEl.appendChild(opt);
    }

    // 기본값: 로그인 사용자의 소속
    if (__MY_AFFILIATION) {
      selectEl.value = __MY_AFFILIATION;
    }

    // 권한별 비활성화
    if (['직원', '지점장'].includes(__MY_ROLE)) {
      selectEl.disabled = true;
      selectEl.classList.add('bg-gray-100', 'text-gray-600', 'cursor-not-allowed');
    }

  } catch (e) {
    console.error('지점 목록 로딩 실패', e);
    showToastGreenRed?.('지점 목록 로딩 실패');
  }
}

// 3) 입력바 기본값/권한반영
function initInputBar() {
  const $branch   = $('#cm-branch');
  const $date     = $('#cm-date');
  const $division = $('#cm-division');
  const $amount   = $('#cm-amount');

  // 날짜: 오늘
  if ($date) $date.value = todayKST();

  // 구분: 기본 '사용비용', 직원은 수정 불가
  if ($division) {
    $division.value = '사용비용';
    if (__MY_ROLE === '직원') {
      $division.disabled = true;
      $division.classList.add('bg-gray-100', 'text-gray-600', 'cursor-not-allowed');
    }
  }

  // 금액: 숫자만 입력되도록 간단 필터
  if ($amount) {
    const format = () => {
      const n = toNumberKR($amount.value);
      $amount.value = n.toLocaleString('ko-KR');
    };
    $amount.addEventListener('input', () => {
      // 입력 중에는 숫자만 유지(콤마 제거)
      const digits = String($amount.value).replace(/[^\d]/g,'');
      $amount.value = digits;
    });
    $amount.addEventListener('blur', format);
  }

  // 지점 select 옵션 채우기
  loadBranchesIntoSelect($branch);
}

// 4) 초기화 플로우
(async function init() {
  const ok = await resolveMyAuthority();
  if (!ok) return; // 내부에서 이동 처리됨
  initInputBar();
})();
