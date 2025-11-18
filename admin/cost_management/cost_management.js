// /admin/cost_management/cost_management.js
import { client as supabase } from '../../modules/core/supabase.js';
import { showToastGreenRed } from '../../modules/ui/toast.js';

const $ = (s, d=document) => d.querySelector(s);

// 권한/소속 전역
let __MY_ROLE = '직원';      // '직원' | '지점장' | '관리자'
let __MY_AFFILIATION = null; // 로그인 사용자의 기본 지점

// 숫자만 남기는 헬퍼
function toNumberKR(v) {
  // 숫자 + 앞에 붙은 마이너스만 허용
  const cleaned = String(v ?? '0').trim().replace(/[^\d-]/g, '');
  // 중간에 -가 여러 개 있는 경우 첫 번째만 인정
  const normalized = cleaned.replace(/(?!^)-/g, '');
  return Number(normalized) || 0;
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
        let v = String($amount.value);

        // 숫자와 -만 허용
        v = v.replace(/[^\d-]/g, '');

        // -가 여러 개 들어가면 첫 번째만 유지
        v = v.replace(/(?!^)-/g, '');

        $amount.value = v;
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

    showToastGreenRed?.('저장 완료', { ok: true });
    // 입력값 리셋(금액/메모만)
    if ($amount) $amount.value = '';
    if ($memo)   $memo.value   = '';

    // TODO: 아래 영역에 리스트를 그릴 예정이면 여기서 재로딩 호출
    await reloadCostList();
  } catch (e) {
    console.error('[cost_management] save failed:', e);
    showToastGreenRed?.('저장 중 오류가 발생했습니다');
  }
}

// === 필터 상태 ===
// 빈 배열([])이면 해당 조건 미적용
const __FILTER = {
  affiliations: [],   // ['파주목동점','일산본점', ...]
  dateFrom: null,     // 'YYYY-MM-DD'
  dateTo: null,       // 'YYYY-MM-DD'
  staffIds: [],       // [uuid, uuid, ...]
  divisions: []       // ['사용비용','통장 입출금']
};

// === 간단 모달 ===
function openModal({ title = '필터', contentHTML = '', onApply = null, onCancel = null }) {
  // 기존 모달 있으면 제거
  const old = document.getElementById('cm-filter-modal');
  if (old) old.remove();

  const wrap = document.createElement('div');
  wrap.id = 'cm-filter-modal';
  wrap.className = 'fixed inset-0 z-[9997] flex items-center justify-center';
  wrap.innerHTML = `
    <div class="absolute inset-0 bg-black/30"></div>
    <div class="relative bg-white rounded-xl shadow-xl w-full max-w-[28rem] border border-gray-200">
      <div class="px-4 py-3 border-b font-bold">${title}</div>
      <div class="p-4 max-h-[70vh] overflow-y-auto">${contentHTML}</div>
      <div class="px-4 py-3 border-t flex justify-end gap-2">
        <button id="cm-modal-cancel" class="px-3 py-1.5 rounded bg-gray-200 hover:bg-gray-300">취소</button>
        <button id="cm-modal-apply"  class="px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700">적용</button>
      </div>
    </div>
  `;

  document.body.appendChild(wrap);

  const cleanup = () => wrap.remove();
  wrap.querySelector('#cm-modal-cancel').onclick = () => { cleanup(); onCancel?.(); };
  wrap.querySelector('#cm-modal-apply').onclick = () => { onApply?.(wrap); cleanup(); };
  wrap.firstElementChild.onclick = () => { cleanup(); onCancel?.(); }; // 배경 클릭 닫기
}

// === 옵션 로더(필터용) ===
async function fetchBranchOptionsForFilter() {
  // 권한 한계 내에서만 제공
  if (__MY_ROLE === '직원' || __MY_ROLE === '지점장') {
    return [__MY_AFFILIATION].filter(Boolean);
  }
  const { data, error } = await supabase
    .from('branch_info')
    .select('affiliation')
    .order('affiliation');
  if (error) throw error;
  return (data || []).map(r => r.affiliation).filter(Boolean);
}

async function fetchStaffOptionsForFilter() {
  let q = supabase.from('staff_profiles')
    .select('id, name, affiliation')
    .is('leave_date', null);

  if (__MY_ROLE === '직원') {
    q = q.eq('id', __MY_STAFF_ID);
  } else if (__MY_ROLE === '지점장') {
    q = q.eq('affiliation', __MY_AFFILIATION);
  } else {
    // 관리자: 만약 지점 필터가 켜져 있으면 그 지점들로 제한(선택 UX에 도움)
    if (__FILTER.affiliations?.length) {
      q = q.in('affiliation', __FILTER.affiliations);
    }
  }
  q = q.order('affiliation').order('name');
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

const DIVISION_OPTIONS = ['사용비용', '통장 입출금'];

// === 목록 로딩: 권한 + 필터 적용 ===
async function fetchCostRows() {
  let query = supabase
    .from('cost_management')
    .select('id, affiliation, date, division, amount, memo, staff_id')
    .order('date', { ascending: false })
    .order('id', { ascending: false })
    .limit(500);

  // 권한 기본 제한
  if (__MY_ROLE === '직원') {
    query = query.eq('staff_id', __MY_STAFF_ID);
  } else if (__MY_ROLE === '지점장') {
    query = query.eq('affiliation', __MY_AFFILIATION);
  }

  // --- 필터 적용 ---
  // 지점
  if (__FILTER.affiliations?.length) {
    query = query.in('affiliation', __FILTER.affiliations);
  }
  // 날짜
  if (__FILTER.dateFrom && __FILTER.dateTo) {
    query = query.gte('date', __FILTER.dateFrom).lte('date', __FILTER.dateTo);
  } else if (__FILTER.dateFrom) {
    query = query.gte('date', __FILTER.dateFrom);
  } else if (__FILTER.dateTo) {
    query = query.lte('date', __FILTER.dateTo);
  }
  // 이름(= staff_id)
  if (__FILTER.staffIds?.length) {
    query = query.in('staff_id', __FILTER.staffIds);
  }
  // 구분
  if (__FILTER.divisions?.length) {
    query = query.in('division', __FILTER.divisions);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = data || [];

  // 직원 이름 맵핑
  const staffIds = Array.from(new Set(rows.map(r => r.staff_id).filter(Boolean)));
  let nameMap = new Map();
  if (staffIds.length > 0) {
    const { data: staffRows, error: staffErr } = await supabase
      .from('staff_profiles')
      .select('id, name')
      .in('id', staffIds);
    if (!staffErr) for (const s of staffRows || []) nameMap.set(s.id, s.name);
  }

  return rows.map(r => ({ ...r, staff_name: nameMap.get(r.staff_id) || '-' }));
}

// === 목록 렌더링: 표 + 헤더 클릭 필터 + 행 클릭 삭제 + 합계 표시 ===
function renderCostList(rows) {
  const $area = $('#cm-list-area');
  if (!$area) return;

  // ----- 합계 계산 -----
  const total = (rows || []).reduce((acc, r) => acc + Number(r.amount || 0), 0);
  const totalHTML = `
    <div class="mb-2">
      <div class="flex items-center gap-3 bg-white rounded-xl shadow border border-gray-200 px-4 py-3 w-[20rem]">
        <span class="text-sm text-gray-600">총 합계</span>
        <span class="ml-auto text-lg font-bold ${total < 0 ? 'text-red-600' : 'text-gray-900'}">
          ${total < 0 ? '-' : ''}${Math.abs(total).toLocaleString('ko-KR')}
        </span>
      </div>
    </div>
  `;

  // 활성 필터 칩
  const chips = [];
  if (__FILTER.affiliations?.length) chips.push(`지점: ${__FILTER.affiliations.join(', ')}`);
  if (__FILTER.dateFrom || __FILTER.dateTo) chips.push(`기간: ${__FILTER.dateFrom || '~'} ~ ${__FILTER.dateTo || '~'}`);
  if (__FILTER.staffIds?.length) chips.push(`이름: ${__FILTER.staffIds.length}명`);
  if (__FILTER.divisions?.length) chips.push(`구분: ${__FILTER.divisions.join(', ')}`);

  const chipsHTML = chips.length ? `
    <div class="mb-2 flex flex-wrap gap-2 items-center">
      ${chips.map(txt => `<span class="px-2 py-1 text-xs rounded-full bg-blue-50 text-blue-700 border border-blue-200">${txt}</span>`).join('')}
      <button id="cm-filter-reset" class="ml-2 text-xs underline text-gray-600 hover:text-gray-900">필터 초기화</button>
    </div>` : '';

  // ----- 비어있을 때 -----
  if (!rows || rows.length === 0) {
    $area.innerHTML = `
      ${totalHTML}
      ${chipsHTML}
      <div class="bg-white rounded-xl shadow border border-gray-200 p-6 text-center text-gray-500">
        표시할 내역이 없습니다.
      </div>`;
    $area.onclick = null;
    const resetBtn = document.getElementById('cm-filter-reset');
    if (resetBtn) resetBtn.onclick = () => {
      Object.assign(__FILTER, {affiliations:[], dateFrom:null, dateTo:null, staffIds:[], divisions:[]});
      reloadCostList();
    };
    return;
  }

  const escapeHTML = (s) => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const html = `
    ${totalHTML}
    ${chipsHTML}
    <div class="bg-white rounded-xl shadow border border-gray-200">
      <div class="overflow-x-auto">
        <table class="min-w-full table-auto text-sm">
          <thead class="bg-gray-100 text-gray-700">
            <tr>
              <th id="cm-th-aff"   class="px-3 py-2 text-left underline decoration-dotted cursor-pointer select-none w-[7rem]">지점</th>
              <th id="cm-th-date"  class="px-3 py-2 text-left underline decoration-dotted cursor-pointer select-none w-[7rem]">날짜</th>
              <th id="cm-th-name"  class="px-3 py-2 text-left underline decoration-dotted cursor-pointer select-none w-[5rem]">이름</th>
              <th id="cm-th-div"   class="px-3 py-2 text-left underline decoration-dotted cursor-pointer select-none w-[10rem]">구분</th>
              <th class="px-3 py-2 text-right w-[8rem]">금액</th>
              <th class="px-3 py-2 text-left min-w-full">메모</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            ${rows.map(r => `
              <tr class="hover:bg-gray-50 cursor-pointer"
                  data-id="${r.id}"
                  data-affiliation="${escapeHTML(r.affiliation)}"
                  data-staff-id="${escapeHTML(r.staff_id || '')}"
                  title="클릭하여 삭제">
                <td class="px-3 py-2">${escapeHTML(r.affiliation)}</td>
                <td class="px-3 py-2 whitespace-nowrap">${escapeHTML(r.date)}</td>
                <td class="px-3 py-2">${escapeHTML(r.staff_name)}</td>
                <td class="px-3 py-2">${escapeHTML(r.division)}</td>
                <td class="px-3 py-2 text-right">${Number(r.amount || 0).toLocaleString('ko-KR')}</td>
                <td class="px-3 py-2">${escapeHTML(r.memo)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
  $area.innerHTML = html;

  // --- 헤더 클릭: 필터 열기 ---
  const $aff = document.getElementById('cm-th-aff');
  const $dt  = document.getElementById('cm-th-date');
  const $nm  = document.getElementById('cm-th-name');
  const $dv  = document.getElementById('cm-th-div');

  if ($aff) $aff.onclick = openBranchFilterModal;
  if ($dt)  $dt.onclick  = openDateFilterModal;
  if ($nm)  $nm.onclick  = openStaffFilterModal;
  if ($dv)  $dv.onclick  = openDivisionFilterModal;

  // --- 리스트 행 클릭 → 삭제 ---
  $area.onclick = async (ev) => {
    const tr = ev.target.closest('tr[data-id]');
    if (!tr) return;
    const rowId = tr.getAttribute('data-id');
    const affiliation = tr.getAttribute('data-affiliation');
    const staff_id = tr.getAttribute('data-staff-id') || null;

    if (!canDeleteRow({ affiliation, staff_id })) {
      showToastGreenRed?.('삭제 권한이 없습니다');
      return;
    }
    if (!window.confirm('해당 내역을 삭제하시겠습니까?')) return;
    await deleteCostRowById(rowId);
  };

  // 필터 초기화 버튼
  const resetBtn = document.getElementById('cm-filter-reset');
  if (resetBtn) resetBtn.onclick = () => {
    Object.assign(__FILTER, { affiliations:[], dateFrom:null, dateTo:null, staffIds:[], divisions:[] });
    reloadCostList();
  };
}

// === 지점 필터 ===
async function openBranchFilterModal() {
  try {
    const affs = await fetchBranchOptionsForFilter();
    const content = `
      <div class="space-y-2">
        <div class="text-sm text-gray-600">여러 지점을 선택할 수 있습니다.</div>
        <div class="grid grid-cols-2 gap-2">
          ${affs.map(a => `
            <label class="flex items-center gap-2">
              <input type="checkbox" class="cm-aff-chk" value="${a}" ${__FILTER.affiliations.includes(a)?'checked':''}>
              <span>${a}</span>
            </label>
          `).join('')}
        </div>
      </div>`;
    openModal({
      title: '지점 선택',
      contentHTML: content,
      onApply: (wrap) => {
        const values = [...wrap.querySelectorAll('.cm-aff-chk:checked')].map(el => el.value);
        __FILTER.affiliations = values;
        reloadCostList();
      }
    });
  } catch (e) {
    console.error('branch filter open fail', e);
    showToastGreenRed?.('지점 목록 로딩 실패');
  }
}

// === 날짜 필터 ===
function openDateFilterModal() {
  const content = `
    <div class="space-y-3">
      <div class="text-sm text-gray-600">기간을 선택하세요.</div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <div class="text-xs text-gray-500 mb-1">시작일</div>
          <input type="date" id="cm-date-from" class="border rounded px-2 py-1.5 w-full" value="${__FILTER.dateFrom || ''}">
        </div>
        <div>
          <div class="text-xs text-gray-500 mb-1">종료일</div>
          <input type="date" id="cm-date-to" class="border rounded px-2 py-1.5 w-full" value="${__FILTER.dateTo || ''}">
        </div>
      </div>
      <div class="flex gap-2">
        <button id="cm-date-quick-7" class="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200">최근 7일</button>
        <button id="cm-date-quick-30" class="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200">최근 30일</button>
        <button id="cm-date-clear" class="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200">기간 지우기</button>
      </div>
    </div>`;
  openModal({
    title: '기간 선택',
    contentHTML: content,
    onApply: (wrap) => {
      const from = wrap.querySelector('#cm-date-from')?.value || null;
      const to   = wrap.querySelector('#cm-date-to')?.value || null;
      __FILTER.dateFrom = from;
      __FILTER.dateTo = to;
      reloadCostList();
    }
  });

  // 퀵 버튼 동작
  const addDays = (d, diff) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
    const y = x.getFullYear(), m = String(x.getMonth()+1).padStart(2,'0'), dd = String(x.getDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  };
  const today = new Date();
  document.getElementById('cm-date-quick-7').onclick = () => {
    document.getElementById('cm-date-from').value = addDays(today, -6);
    document.getElementById('cm-date-to').value   = addDays(today, 0);
  };
  document.getElementById('cm-date-quick-30').onclick = () => {
    document.getElementById('cm-date-from').value = addDays(today, -29);
    document.getElementById('cm-date-to').value   = addDays(today, 0);
  };
  document.getElementById('cm-date-clear').onclick = () => {
    document.getElementById('cm-date-from').value = '';
    document.getElementById('cm-date-to').value   = '';
  };
}

// === 이름(직원) 필터 ===
async function openStaffFilterModal() {
  try {
    const staffs = await fetchStaffOptionsForFilter(); // [{id,name,affiliation}]
    const content = `
      <div class="space-y-2">
        <div class="text-sm text-gray-600">여러 명을 선택할 수 있습니다.</div>
        <div class="max-h-[50vh] overflow-y-auto divide-y border rounded">
          ${staffs.map(s => `
            <label class="flex items-center gap-2 px-3 py-2">
              <input type="checkbox" class="cm-stf-chk" value="${s.id}" ${__FILTER.staffIds.includes(s.id)?'checked':''}>
              <span class="flex-1">${s.name}</span>
              <span class="text-xs text-gray-500">${s.affiliation || ''}</span>
            </label>
          `).join('')}
        </div>
      </div>`;
    openModal({
      title: '이름 선택',
      contentHTML: content,
      onApply: (wrap) => {
        const values = [...wrap.querySelectorAll('.cm-stf-chk:checked')].map(el => el.value);
        __FILTER.staffIds = values;
        reloadCostList();
      }
    });
  } catch (e) {
    console.error('staff filter open fail', e);
    showToastGreenRed?.('직원 목록 로딩 실패');
  }
}

// === 구분 필터 ===
function openDivisionFilterModal() {
  const content = `
    <div class="space-y-2">
      <div class="text-sm text-gray-600">구분을 선택하세요(복수 선택 가능).</div>
      <div class="flex flex-col gap-2">
        ${DIVISION_OPTIONS.map(dv => `
          <label class="inline-flex items-center gap-2">
            <input type="checkbox" class="cm-dv-chk" value="${dv}" ${__FILTER.divisions.includes(dv)?'checked':''}>
            <span>${dv}</span>
          </label>
        `).join('')}
      </div>
    </div>`;
  openModal({
    title: '구분 선택',
    contentHTML: content,
    onApply: (wrap) => {
      const values = [...wrap.querySelectorAll('.cm-dv-chk:checked')].map(el => el.value);
      __FILTER.divisions = values;
      reloadCostList();
    }
  });
}

// === 목록 리로드(로딩 → 렌더) ===
async function reloadCostList() {
  try {
    const rows = await fetchCostRows();
    renderCostList(rows);
  } catch (e) {
    console.error('[cost_management] 목록 로딩 실패:', e);
    showToastGreenRed?.('목록 로딩 실패');
  }
}

// === 삭제: 단일 행 삭제 ===
async function deleteCostRowById(rowId) {
  try {
    const { error } = await supabase
      .from('cost_management')
      .delete()
      .eq('id', rowId);

    if (error) throw error;

    showToastGreenRed?.('삭제 완료');
    await reloadCostList();
  } catch (e) {
    console.error('[cost_management] 삭제 실패:', e);
    showToastGreenRed?.('삭제 실패');
  }
}

// 권한 체크: 이 행을 내가 삭제할 수 있는가?
function canDeleteRow({ affiliation, staff_id }) {
  if (__MY_ROLE === '관리자') return true;
  if (__MY_ROLE === '지점장') return affiliation === __MY_AFFILIATION;
  // 직원: 본인 건만
  if (__MY_ROLE === '직원') return staff_id === __MY_STAFF_ID;
  return false;
}

// 4) 초기화
(async function init() {
    const ok = await resolveMyAuthority();
    if (!ok) return; // 내부에서 이동 처리됨
    initInputBar();
    await reloadCostList();
    // [ADD] 정산 탭 표시/숨김 (관리자/지점장만 보이기)
    {
        const tab = document.getElementById('settlement-tab');
        if (tab) {
            if (__MY_ROLE === '직원') {
            tab.style.display = 'none';
            } else {
            tab.style.removeProperty('display');
            }
        }
    }
})();
