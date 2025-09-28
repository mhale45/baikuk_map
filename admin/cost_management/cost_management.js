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
// YYYY-MM-DD (오늘, 로컬 기준)
function todayStr() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth()+1).padStart(2,'0');
  const dd = String(now.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

// 1) 로그인/권한 확인 (미로그인 → listings로 이동)
let __MY_STAFF_ID = null;
let __MY_NAME = null;

async function resolveMyAuthority() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      window.location.href = '/admin/listings/';
      return false;
    }

    // id, name까지 조회 (본인 staff row 필요)
    const { data: rows, error } = await supabase
      .from('staff_profiles')
      .select('id, name, authority, affiliation')
      .eq('user_id', user.id)
      .is('leave_date', null);

    if (error) throw error;

    __MY_ROLE = '직원';
    __MY_AFFILIATION = null;
    __MY_STAFF_ID = null;
    __MY_NAME = null;

    // 우선순위: 관리자 > 지점장 > 직원
    let picked = null;
    for (const r of (rows || [])) {
      if (r.authority === '관리자') { __MY_ROLE = '관리자'; picked = picked || r; }
    }
    if (!picked) {
      for (const r of (rows || [])) {
        if (r.authority === '지점장') { __MY_ROLE = '지점장'; picked = picked || r; }
      }
    }
    if (!picked && rows && rows.length) {
      __MY_ROLE = '직원';
      picked = rows[0];
    }

    if (picked) {
      __MY_AFFILIATION = picked.affiliation || null;
      __MY_STAFF_ID = picked.id || null;
      __MY_NAME = picked.name || null;
      // 관리자라도 소속이 있으면 기본 지점값으로 활용
      if (!__MY_AFFILIATION && rows?.[0]?.affiliation) {
        __MY_AFFILIATION = rows[0].affiliation;
      }
    }

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

// 2) 지점 목록 로드 → select 옵션 구성
async function loadBranchesIntoSelect(selectEl) {
  if (!selectEl) return;
  try {
    const { data, error } = await supabase
      .from('branch_info')
      .select('affiliation')
      .order('affiliation', { ascending: true });
    if (error) throw error;

    selectEl.innerHTML = '';

    // [ADMIN 전용] "전체 지점" 옵션
    if (__MY_ROLE === '관리자') {
      const allOpt = document.createElement('option');
      allOpt.value = '__ALL__';
      allOpt.textContent = '전체 지점';
      selectEl.appendChild(allOpt);
    }

    for (const row of (data || [])) {
      if (!row?.affiliation) continue;
      const opt = document.createElement('option');
      opt.value = row.affiliation;
      opt.textContent = row.affiliation;
      selectEl.appendChild(opt);
    }

    // 기본값 세팅
    if (__MY_AFFILIATION && [...selectEl.options].some(o => o.value === __MY_AFFILIATION)) {
      selectEl.value = __MY_AFFILIATION;
    }

    // [중요 변경] 직원/지점장 모두 비활성화 (본인 지점만 고정)
    if (__MY_ROLE === '직원' || __MY_ROLE === '지점장') {
      selectEl.disabled = true;
      selectEl.classList.add('bg-gray-100', 'text-gray-600', 'cursor-not-allowed');
    } else {
      // 관리자만 활성화
      selectEl.disabled = false;
      selectEl.classList.remove('bg-gray-100', 'text-gray-600', 'cursor-not-allowed');
    }
  } catch (e) {
    console.error('지점 목록 로딩 실패', e);
    showToastGreenRed?.('지점 목록 로딩 실패');
  }
}

// 직원 목록 로드 → select 옵션 구성
// - 직원: 본인만 (비활성화)
// - 지점장: 본인 지점 직원만 (활성화, 선택 가능)
// - 관리자: 선택 지점(또는 전체 지점) 직원 (optgroup), 내 지점 그룹 우선, 내 이름 기본 선택
async function loadStaffIntoSelect(selectEl, currentBranchValue) {
  if (!selectEl) return;

  // optgroup 렌더 헬퍼 (관리자용)
  const renderGrouped = (el, rows) => {
    el.innerHTML = '';

    // affiliation -> [rows] 맵
    const groupMap = new Map();
    for (const r of (rows || [])) {
      const aff = r.affiliation || '미지정';
      if (!groupMap.has(aff)) groupMap.set(aff, []);
      groupMap.get(aff).push(r);
    }

    // 내 지점을 최상단으로
    const affs = Array.from(groupMap.keys()).sort((a, b) => {
      if (a === __MY_AFFILIATION) return -1;
      if (b === __MY_AFFILIATION) return 1;
      return a.localeCompare(b, 'ko');
    });

    let hasSelected = false;

    for (const aff of affs) {
      const og = document.createElement('optgroup');
      og.label = aff;
      const list = groupMap.get(aff).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      for (const r of list) {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = r.name;
        if (r.id === __MY_STAFF_ID) {
          opt.selected = true;
          hasSelected = true;
        }
        og.appendChild(opt);
      }
      el.appendChild(og);
    }

    // 내 계정을 찾지 못했으면 첫 옵션 선택
    if (!hasSelected && el.options.length > 0) {
      el.options[0].selected = true;
    }
  };

  try {
    // 1) 직원: 본인만
    if (__MY_ROLE === '직원') {
      const { data, error } = await supabase
        .from('staff_profiles')
        .select('id, name, affiliation')
        .eq('id', __MY_STAFF_ID)
        .is('leave_date', null)
        .maybeSingle();
      if (error) throw error;

      selectEl.innerHTML = '';
      const opt = document.createElement('option');
      opt.value = data?.id || __MY_STAFF_ID || '';
      opt.textContent = data?.name || __MY_NAME || '본인';
      opt.selected = true;
      selectEl.appendChild(opt);

      selectEl.disabled = true;
      selectEl.classList.add('bg-gray-100', 'text-gray-600', 'cursor-not-allowed');
      return;
    }

    // 2) 지점장: 본인 지점 직원만 (활성화)
    if (__MY_ROLE === '지점장') {
      const { data, error } = await supabase
        .from('staff_profiles')
        .select('id, name, affiliation')
        .eq('affiliation', __MY_AFFILIATION)
        .is('leave_date', null)
        .order('name', { ascending: true });
      if (error) throw error;

      // 단일 지점이지만 보기 좋게 optgroup 유지
      selectEl.innerHTML = '';
      const og = document.createElement('optgroup');
      og.label = __MY_AFFILIATION || '미지정';

      let hasSelected = false;
      for (const r of (data || [])) {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = r.name;
        if (r.id === __MY_STAFF_ID) {
          opt.selected = true;
          hasSelected = true;
        }
        og.appendChild(opt);
      }
      selectEl.appendChild(og);

      if (!hasSelected && selectEl.options.length > 0) {
        selectEl.options[0].selected = true;
      }

      selectEl.disabled = false; // 지점장은 본인 지점 내에서 선택 가능
      selectEl.classList.remove('bg-gray-100', 'text-gray-600', 'cursor-not-allowed');
      return;
    }

    // 3) 관리자: 선택 지점/전체 지점
    let query = supabase
      .from('staff_profiles')
      .select('id, name, affiliation')
      .is('leave_date', null);

    if (currentBranchValue && currentBranchValue !== '__ALL__') {
      query = query.eq('affiliation', currentBranchValue);
    }
    query = query.order('affiliation', { ascending: true }).order('name', { ascending: true });

    const { data, error } = await query;
    if (error) throw error;

    renderGrouped(selectEl, data || []);
    selectEl.disabled = false;
    selectEl.classList.remove('bg-gray-100', 'text-gray-600', 'cursor-not-allowed');
  } catch (e) {
    console.error('직원 목록 로딩 실패', e);
    showToastGreenRed?.('직원 목록 로딩 실패');
  }
}

// 3) 입력바 기본값/권한 반영 + 최소폭 유지용 클래스 보강
function initInputBar() {
  const $branch   = $('#cm-branch');
  const $date     = $('#cm-date');
  const $division = $('#cm-division');
  const $amount   = $('#cm-amount');
  const $staff    = $('#cm-staff');    // [NEW: 이름 select]

  // 날짜: 오늘
  if ($date) $date.value = todayStr();

  // 구분: 기본 '사용비용' (직원은 수정 불가)
  if ($division) {
    $division.value = '사용비용';
    if (__MY_ROLE === '직원') {
      $division.disabled = true;
      $division.classList.add('bg-gray-100', 'text-gray-600', 'cursor-not-allowed');
    } else {
      $division.disabled = false;
      $division.classList.remove('bg-gray-100', 'text-gray-600', 'cursor-not-allowed');
    }
  }

  // 금액: 숫자만, blur 시 콤마
  if ($amount) {
    const format = () => {
      const n = toNumberKR($amount.value);
      $amount.value = n ? n.toLocaleString('ko-KR') : '';
    };
    $amount.addEventListener('input', () => {
      const digits = String($amount.value).replace(/[^\d]/g,'');
      $amount.value = digits;
    });
    $amount.addEventListener('blur', format);
  }

  // 지점 select 로딩
  loadBranchesIntoSelect($branch);

  // 직원 select 로딩 (권한/지점에 따라)
  loadStaffIntoSelect($staff, $branch?.value || null);

  // 관리자: 지점 변경 시 직원 목록도 동기화 (전체 지점 지원)
    if ($branch && __MY_ROLE === '관리자') {
        $branch.addEventListener('change', () => {
            const v = $branch.value || '__ALL__'; // 빈 값 방지
            loadStaffIntoSelect($staff, v);
        });
    }

  // ❗ select / input 최소폭 유지 (텍스트 길이에 맞춤)
  [$branch, $date, $division, $amount, $staff].forEach(el => {
    if (!el) return;
    el.classList.add('w-auto');
  });

    // 저장 버튼 클릭 → 저장 로직 호출
  const $saveBtn = $('#cm-save-btn');
  if ($saveBtn) {
    $saveBtn.addEventListener('click', async () => {
      try {
        $saveBtn.disabled = true;
        $saveBtn.classList.add('opacity-60', 'cursor-not-allowed');
        await saveCostRow();
      } finally {
        $saveBtn.disabled = false;
        $saveBtn.classList.remove('opacity-60', 'cursor-not-allowed');
      }
    });
  }
}

// === 저장 로직: cost_management 테이블에 한 행 저장 ===
async function saveCostRow() {
  try {
    const $branch   = $('#cm-branch');
    const $date     = $('#cm-date');
    const $division = $('#cm-division');
    const $amount   = $('#cm-amount');
    const $memo     = $('#cm-memo');
    const $staff    = $('#cm-staff');

    // 값 읽기/검증
    const affiliation = $branch?.value || '';
    if (!affiliation || affiliation === '__ALL__') {
      showToastGreenRed?.('지점을 선택하세요');
      return;
    }

    const dateVal  = $date?.value || todayStr();
    const division = $division?.value || '사용비용';
    const amount   = toNumberKR($amount?.value);
    if (!amount) {
      showToastGreenRed?.('금액을 입력하세요');
      return;
    }

    // 직원 id: select에 이미 staff_profiles.id가 value로 들어감
    const staff_id = $staff?.value || __MY_STAFF_ID;
    if (!staff_id) {
      showToastGreenRed?.('직원 선택 정보를 확인할 수 없습니다');
      return;
    }

    const memo = String($memo?.value || '').trim();

    // title/status 는 UI에 없으므로 생략(서버 디폴트 또는 NULL)
    const payload = {
      affiliation,
      date: dateVal,     // date 컬럼
      division,          // text
      amount,            // numeric
      memo,              // text
      staff_id           // uuid
    };

    const { error } = await supabase
      .from('cost_management')
      .insert(payload);

    if (error) {
      console.error('[cost_management] insert error:', error);
      showToastGreenRed?.('저장 실패');
      return;
    }

    showToastGreenRed?.('저장 완료');
    // 입력값 리셋(금액/메모만)
    if ($amount) $amount.value = '';
    if ($memo)   $memo.value   = '';

    // TODO: 아래 영역에 리스트를 그릴 예정이면 여기서 재로딩 호출
    // await reloadCostList();  // (추후 구현)
  } catch (e) {
    console.error('[cost_management] save failed:', e);
    showToastGreenRed?.('저장 중 오류가 발생했습니다');
  }
}

// 4) 초기화
(async function init() {
  const ok = await resolveMyAuthority();
  if (!ok) return; // 내부에서 이동 처리됨
  initInputBar();
})();
