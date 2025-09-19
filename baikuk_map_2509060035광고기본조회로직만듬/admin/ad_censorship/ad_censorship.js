// ad_censorship.js

// /admin/ad_censorship/ad_censorship.js
// 모듈화 버전 — 직원 패널 렌더 + 권한별 클릭 제어 + 필터 이벤트 방출
// 사용법 (index.html):
//   import { initAdCensorship, getSelectedFilters } from './ad_censorship.js'
//   initAdCensorship();

import { client as supabase, waitForSupabase } from '../../modules/core/supabase.js';
import { showToastGreenRed } from '../../modules/ui/toast.js';

// --- 전역 노출 (기존 페이지와 동일 동작 유지) ---
window.supabase = supabase;
document.dispatchEvent(new Event('supabase-ready'));

// === 내부 상태 ===
let __selectedStaffId = null;            // 선택된 직원 ID (string)
let __selectedAffiliation = null;        // 선택된 지점명 (string)
const __AFFIL_STAFF_IDS = (window.__AFFIL_STAFF_IDS ||= {}); // 지점→직원ID Set 캐시

// === DOM refs (지연 바인딩) ===
const $ = (sel, root = document) => root.querySelector(sel);

// === 인증/권한 조회 ===
async function getMyAuthorityAndStaffId() {
  await waitForSupabase();
  const { data: sessionRes, error: sErr } = await supabase.auth.getSession();
  if (sErr) throw sErr;
  const user = sessionRes?.session?.user;
  if (!user?.id) throw new Error('로그인이 필요합니다.');

  const { data: staff, error: spErr } = await supabase
    .from('staff_profiles')
    .select('id, authority, affiliation')
    .eq('user_id', user.id)
    .maybeSingle();

  if (spErr) throw spErr;
  if (!staff) throw new Error('staff_profiles에서 사용자 정보를 찾을 수 없습니다.');

  const authority = staff.authority || '';
  const isStaff = authority === '직원';

  // 페이지 전역 상태와도 동기화 (타 모듈 호환)
  window.__userRole = authority;
  window.__isStaff  = isStaff;

  return { authority, isStaff, staffId: staff.id, affiliation: staff.affiliation, userId: user.id };
}

// === 직원 클릭 시 선택/강조 ===
function setActiveStaff(container, staffId) {
  __selectedStaffId = staffId;
  __selectedAffiliation = null;

  container.querySelectorAll('.grade-header').forEach(h => h.classList.remove('ring-2','ring-yellow-400'));
  container.querySelectorAll('.name-item').forEach(el => {
    if (el.dataset.disabled === '1') return;
    if (String(el.dataset.staffId) === String(staffId)) el.classList.add('bg-yellow-200');
    else el.classList.remove('bg-yellow-200');
  });

  emitFilterChange();
}

// === 필터 변경 이벤트 브로드캐스트 ===
function emitFilterChange() {
  document.dispatchEvent(new CustomEvent('adc:filter-change', {
    detail: {
      staffId: __selectedStaffId ? String(__selectedStaffId) : null,
      affiliation: __selectedAffiliation || null
    }
  }));
}

// === 외부에서 현재 선택 상태 조회할 때 사용 ===
export function getSelectedFilters() {
  return {
    staffId: __selectedStaffId ? String(__selectedStaffId) : null,
    affiliation: __selectedAffiliation || null
  };
}

// === 직원 사이드바 렌더 ===
async function renderStaffSidebar(me) {
  // 1) 직원 목록 로드 (권한별 재직자 필터)
  let staffQuery = supabase
    .from('staff_profiles')
    .select('id, name, affiliation, leave_date, ad_channel')
    .order('affiliation', { ascending: true })
    .order('name', { ascending: true });

  if (me.authority === '직원') {
    staffQuery = staffQuery.is('leave_date', null); // 직원은 재직자만
  }

  const { data, error } = await staffQuery;
  if (error) {
    console.error('직원 정보 실패:', error);
    showToastGreenRed?.('직원 정보를 불러오지 못했습니다.');
    return;
  }

  // 2) 소속별 그룹핑 + 캐시
    const grouped = {};
    (data || []).forEach(({ id, name, affiliation, leave_date, ad_channel }) => {
        if (!grouped[affiliation]) grouped[affiliation] = { active: [], inactive: [] };
        const entry = { id, name, affiliation, leave_date, ad_channel }; // ✅ ad_channel 유지
        if (!leave_date) grouped[affiliation].active.push(entry);
        else grouped[affiliation].inactive.push(entry);

        if (!__AFFIL_STAFF_IDS[affiliation]) __AFFIL_STAFF_IDS[affiliation] = new Set();
        __AFFIL_STAFF_IDS[affiliation].add(String(id));
    });


  const container = $('#staff-list');
  if (!container) return;
  container.innerHTML = '';

  // 3) 권한별 클릭 허용 로직
  const canClickStaff = (emp) => {
    if (me.authority === '관리자') return true;
    if (me.authority === '지점장') return emp.affiliation === me.affiliation;
    if (me.authority === '직원')   return String(emp.id) === String(me.staffId);
    return false;
  };
  const canClickAff = (aff) => {
    if (me.authority === '관리자') return true;
    if (me.authority === '지점장') return aff === me.affiliation;
    return false; // 직원은 지점 헤더 클릭 불가
  };

  // 4) 렌더링
  let firstClickableStaffEl = null;

  Object.entries(grouped).forEach(([aff, { active, inactive }], idx) => {
    // --- 지점 헤더 ---
    const header = document.createElement('div');
    header.className = 'grade-header';
    header.textContent = aff;

    if (canClickAff(aff)) {
      header.classList.add('cursor-pointer', 'hover:bg-yellow-100');
      header.title = '이 지점의 전체 데이터 보기';
      header.addEventListener('click', () => {
        if (__selectedAffiliation === aff) {
          __selectedAffiliation = null;
          header.classList.remove('ring-2', 'ring-yellow-400');
        } else {
          __selectedAffiliation = aff;
          __selectedStaffId = null;
          container.querySelectorAll('.grade-header').forEach(h => h.classList.remove('ring-2','ring-yellow-400'));
          header.classList.add('ring-2', 'ring-yellow-400');
          container.querySelectorAll('.name-item').forEach(el => el.classList.remove('bg-yellow-200'));
        }
        emitFilterChange();
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
        // ✅ 클릭 시 조회에 사용할 데이터 속성 추가
        el.dataset.branch = emp.affiliation || '';
        el.dataset.channel = emp.ad_channel || '';

        let displayName = dim ? `${emp.name} (퇴사)` : emp.name;
        if (emp.ad_channel) {
            displayName += ` (${emp.ad_channel})`;
        }
        el.textContent = displayName;

        const allowed = canClickStaff(emp);
        if (!allowed) {
            el.classList.add('opacity-50', 'pointer-events-none', 'select-none');
            el.dataset.disabled = '1';
        } else {
            el.classList.add('cursor-pointer', 'hover:bg-yellow-100');
            if (!firstClickableStaffEl) firstClickableStaffEl = el;
        }
        return el;
    };


    active.forEach((emp) => container.appendChild(makeName(emp)));

    // --- 퇴사자 토글(관리자/지점장만 노출) ---
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
        // ✅ 클릭 시 조회에 사용할 데이터 속성도 함께 저장(비활성이라 클릭은 막히지만 일관성 유지)
        el.dataset.branch = emp.affiliation || '';
        el.dataset.channel = emp.ad_channel || '';

        let displayName = `${emp.name} (퇴사)`;
        if (emp.ad_channel) {
            displayName += ` (${emp.ad_channel})`;
        }
        el.textContent = displayName;

        el.classList.add('opacity-60', 'pointer-events-none', 'select-none');
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

  // 5) 직원 클릭 핸들러(단일 직원 필터 + 매물 조회/렌더)
    container.addEventListener('click', async (e) => {
        const el = e.target.closest('.name-item');
        if (!el || el.dataset.disabled === '1') return;

        // 선택 강조(기존 로직)
        setActiveStaff(container, el.dataset.staffId);

        // ✅ 클릭한 직원의 소속/채널로 supabase 조회
        const branchName = el.dataset.branch || '';
        const channel = (el.dataset.channel || '').trim();

        // 패널/메타 영역
        const panel = document.getElementById('employee-listings-panel');
        const meta = document.getElementById('employee-listings-meta');
        const resultBox = document.getElementById('employee-listings');
        if (!panel || !meta || !resultBox) return;

        // 가드: 소속/채널 없으면 안내
        if (!branchName || !channel) {
            panel.style.display = '';
            meta.textContent = '이 직원의 소속 또는 채널 정보가 없어 조회할 수 없습니다.';
            resultBox.innerHTML = '';
            return;
        }

        // 로딩 표시
        panel.style.display = '';
        meta.textContent = '불러오는 중...';
        resultBox.innerHTML = '';

        try {
            const likeValue = `%${channel}%`;
            const { data, error } = await supabase
            .from('ad_baikuk_listings')
            .select('ad_listing_id, description_listing_id')
            .eq('branch_name', branchName)
            .ilike('agent_name', likeValue);

            if (error) throw error;

            const rows = data || [];
            meta.innerHTML = `소속 <strong>${branchName}</strong> · 채널 <strong>${channel}</strong> 조건으로 검색된 결과: <strong>${rows.length}</strong>건`;

            if (!rows.length) {
                resultBox.innerHTML = `<div style="padding:8px; color:#666;">조건에 맞는 매물이 없습니다.</div>`;
                return;
            }

            // ✅ 표 생성
            const table = document.createElement('table');
            table.className = 'min-w-full border-collapse border border-gray-300 text-sm';
            table.innerHTML = `
            <thead class="bg-gray-100">
                <tr>
                <th class="border border-gray-300 px-3 py-2 text-left">네이버</th>
                <th class="border border-gray-300 px-3 py-2 text-left">매물번호</th>
                </tr>
            </thead>
            <tbody></tbody>
            `;

            const tbody = table.querySelector('tbody');

            // 행 추가
            rows.forEach(row => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="border border-gray-300 px-3 py-1">${row.ad_listing_id ?? '-'}</td>
                    <td class="border border-gray-300 px-3 py-1">${row.description_listing_id ?? '-'}</td>
                `;
                tbody.appendChild(tr);
            });

            resultBox.appendChild(table);
        } catch (err) {
            console.error(err);
            meta.textContent = '매물 조회 중 오류가 발생했습니다.';
            resultBox.innerHTML = '';
        }
    });


  // 6) UX: 직원 권한이면 본인을 자동 선택(조회까지 실행)
    if (me.isStaff && me.staffId) {
        const myEl = container.querySelector(`.name-item[data-staff-id="${me.staffId}"]`);
        if (myEl) {
            myEl.click(); // ✅ 클릭 트리거 → 하이라이트 + 조회
        } else {
            setActiveStaff(container, me.staffId); // fallback
        }
    }

}

// === 초기화 ===
export async function initAdCensorship() {
  // (선택) 미로그인 방지
  try {
    await waitForSupabase();
    const { data } = await supabase.auth.getSession();
    if (!data?.session) {
      location.replace('/');
      return;
    }
  } catch (e) {
    console.warn(e);
  }

  // 내 권한/소속/ID 파악 후 사이드바 렌더
  const me = await getMyAuthorityAndStaffId();
  await renderStaffSidebar(me);

  // 예시: 다른 모듈에서 필터 변경 수신
  // document.addEventListener('adc:filter-change', (e) => {
  //   const { staffId, affiliation } = e.detail || {};
  //   // TODO: 광고 검열 리스트 쿼리 갱신/필터링
  // });
}
