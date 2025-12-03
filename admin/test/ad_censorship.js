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

// === 내부 상태 ===
let __selectedStaffId = null;            // 선택된 직원 ID (string)
let __selectedAffiliation = null;        // 선택된 지점명 (string)
let __selectedChannel = null;            // 선택된 채널 (string)
const __AFFIL_STAFF_IDS = (window.__AFFIL_STAFF_IDS ||= {}); // 지점→직원ID Set 캐시

// === DOM refs (지연 바인딩) ===
const $ = (sel, root = document) => root.querySelector(sel);

// [ADD] 채널 문자열을 ','로 분리하고 공백 제거
function _splitChannels(str) {
  return String(str || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

// [ADD] 거래상태 문자열에서 'YYYY-MM-DD' 날짜 꼬리 제거
function _stripDateFromStatus(str) {
  if (str === null || str === undefined) return '';
  // 공백 포함 ' 2025-09-01' 같은 패턴 제거
  return String(str).replace(/\s*\d{4}-\d{2}-\d{2}\s*/g, '').trim();
}

// ISO 문자열 또는 Date → "YYYY. M. D. HH:mm" (KST) 로 변환
function formatDate(input) {
  const d = (input instanceof Date) ? input : new Date(input);
  if (isNaN(d)) return '';

  // KST로 표시
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const get = (type) => parts.find(p => p.type === type)?.value || '';
  const y  = get('year');
  const m  = Number(get('month'));
  const day = Number(get('day'));
  const hh = get('hour').padStart(2, '0');
  const mm = get('minute').padStart(2, '0');

  return `${y}. ${m}. ${day}. ${hh}:${mm}`;
}

// [ADD] 시간 차이 계산 유틸
function diffHours(dateA, dateB) {
  return Math.abs(dateA.getTime() - dateB.getTime()) / (1000 * 60 * 60);
}

function wrapRedIf(condition, text) {
  return condition
    ? `<span class="text-red-600 font-semibold">${text}</span>`
    : text;
}

// [ADD] HTML 이스케이프 유틸 (features 값 안전 출력용)
function _escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// [RESTORE] 금액 파싱/비교 유틸
function _normMoney(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;

  // ✅ 모든 콤마/숫자외 문자 제거
  const s = String(v).replace(/[^\d.-]/g, '');
  if (!s || s === '-' || s === '.' || s === '-.') return null;

  const n = Number(s);
  return isNaN(n) ? null : n;
}

function _compareMoney(current, baseline, diffLabel) {
  const c = _normMoney(current);
  const b = _normMoney(baseline);
  if (c === null && b === null) return '';
  if (c !== null && b !== null && c !== b) return `<span class="font-semibold text-red-600">${diffLabel}</span>`;
  return c === null ? '' : c.toLocaleString();
}

// === 채널 광고 개수 조회 유틸 ===
// branch(=지점명) + channel(=직원의 ad_channel)을 기준으로 ad_baikuk_listings에서 개수만 가져온다.
// Supabase의 count 전용 옵션(head: true)을 사용해 네트워크 부하를 줄인다.
async function fetchAdCountByBranchAndChannel(branchName, channel) {
  if (!branchName || !channel) return 0;
  const likeValue = `%${String(channel).trim()}%`;
  const { count, error } = await supabase
    .from('ad_baikuk_listings')
    .select('*', { count: 'exact', head: true })
    .eq('branch_name', branchName)
    .ilike('agent_name', likeValue);

  if (error) {
    console.warn('count 조회 실패:', error);
    return 0;
  }
  return count || 0;
}

// 간단한 동시성 제한 실행기
async function runWithLimit(items, limit, worker) {
  const queue = [...items];
  const workers = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (queue.length) {
      const it = queue.shift();
      try { await worker(it); } catch (e) { console.warn(e); }
    }
  });
  await Promise.all(workers);
}

// 컨테이너 내 .name-item 들에 대해 ad-count 채우기
async function fillStaffAdCounts(container) {
  const nodes = Array.from(container.querySelectorAll('.name-item'));
  await runWithLimit(nodes, 5, async (el) => {
    const span = el.querySelector('.ad-count');
    if (!span) return;

    const branchName = el.dataset.branch || '';
    const channel = (el.dataset.channel || '').trim();

    if (!branchName || !channel) {
      span.textContent = '0';
      span.removeAttribute('data-loading');
      return;
    }

    const c = await fetchAdCountByBranchAndChannel(branchName, channel);
    span.textContent = String(c);
    span.removeAttribute('data-loading');
  });
}

// === 지점 전체 광고 개수 조회 유틸 ===
// 지점명(branch_name)으로 ad_baikuk_listings 전체 개수(count)만 가져온다.
async function fetchAdCountByBranch(branchName) {
  if (!branchName) return 0;
  const { count, error } = await supabase
    .from('ad_baikuk_listings')
    .select('*', { count: 'exact', head: true })
    .eq('branch_name', branchName);

  if (error) {
    console.warn('branch count 조회 실패:', error);
    return 0;
  }
  return count || 0;
}

// 컨테이너 내 지점 헤더(.grade-header)들에 대해 지점 전체 광고 개수 채우기
async function fillAffAdCounts(container) {
  const nodes = Array.from(container.querySelectorAll('.grade-header'));
  await runWithLimit(nodes, 5, async (header) => {
    const span = header.querySelector('.aff-count');
    if (!span) return;

    const branchName = header.dataset.aff || header.textContent?.trim() || '';
    if (!branchName) {
      span.textContent = '0';
      span.removeAttribute('data-loading');
      return;
    }

    const c = await fetchAdCountByBranch(branchName);
    span.textContent = String(c);
    span.removeAttribute('data-loading');
  });
}

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
function setActiveStaff(container, staffId, channel) {
  __selectedStaffId = staffId;
  __selectedChannel = (channel ?? '').trim();
  __selectedAffiliation = null;

  // 지점 헤더 강조 해제
  container.querySelectorAll('.grade-header').forEach(h => h.classList.remove('ring-2','ring-yellow-400'));

  // 직원/채널이 모두 일치하는 줄만 노란 강조
  container.querySelectorAll('.name-item').forEach(el => {
    if (el.dataset.disabled === '1') return;
    const sameStaff   = String(el.dataset.staffId) === String(staffId);
    const elChannel   = (el.dataset.channel || '').trim();
    const sameChannel = elChannel === __selectedChannel;
    if (sameStaff && sameChannel) el.classList.add('bg-yellow-200');
    else el.classList.remove('bg-yellow-200');
  });

  emitFilterChange();
}

// === 필터 변경 이벤트 브로드캐스트 ===
function emitFilterChange() {
  document.dispatchEvent(new CustomEvent('adc:filter-change', {
    detail: {
      staffId: __selectedStaffId ? String(__selectedStaffId) : null,
      affiliation: __selectedAffiliation || null,
      channel: __selectedChannel || null
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

// timetz 문자열을 KST 오늘 날짜와 결합해 Date 객체로 반환 (오전/오후까지 지원)
function _timetzToTodayISO(tzStr) {
  if (!tzStr) return null;
  let raw = String(tzStr).trim();

  // 0) "오전/오후 HH:mm(:ss)" → 24시간제로 변환
  //    예) "오전 09:04:05" -> "09:04:05", "오후 12:15" -> "12:15", "오후 01:30" -> "13:30"
  const ampm = raw.match(/^(오전|오후)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (ampm) {
    const isPM = ampm[1] === '오후';
    let hh = parseInt(ampm[2], 10);
    const mm = ampm[3];
    const ss = ampm[4] || '00';
    if (isPM && hh < 12) hh += 12;
    if (!isPM && hh === 12) hh = 0;
    raw = `${String(hh).padStart(2,'0')}:${mm}:${ss}`;
  }

  // 1) 오늘 날짜를 KST 기준으로 YYYY-MM-DD 생성
  const datePart = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  // 2) timetz 파싱: "HH:mm(:ss)" + optional offset(+09, +0900, +09:00)
  const m = raw.match(/^(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*([+-]\d{1,2})(?::?(\d{2}))?)?$/);
  if (!m) return null;

  const timePart = m[1];
  let offH = (m[2] !== undefined) ? Number(m[2]) : 9;
  let offM = (m[3] !== undefined) ? Number(m[3]) : 0;

  const sign = offH >= 0 ? '+' : '-';
  offH = Math.abs(offH);
  const offset = `${sign}${String(offH).padStart(2,'0')}:${String(offM).padStart(2,'0')}`;

  const hhmmss = timePart.length === 5 ? `${timePart}:00` : timePart;
  const iso = `${datePart}T${hhmmss}${offset}`;
  const d = new Date(iso);

  return isNaN(d.getTime()) ? null : d;
}

// ✅ update_log의 imDae_sheet_timetz가 "timestamptz" 또는 "timetz" 모두 들어와도 처리
function _parseUpdateLogTime(v) {
  if (!v) return null;

  // Date 객체면 그대로
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;

  const s = String(v).trim();

  // 1) "YYYY-MM-DD HH:mm:ss+09" 또는 "YYYY-MM-DDTHH:mm:ssZ" 같은 전체 타임스탬프인 경우
  //    - 공백을 'T'로 바꿔도 표준 Date 파서가 읽습니다.
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?([+-]\d{2}:?\d{2}|Z)?$/.test(s)) {
    const isoLike = s.replace(' ', 'T'); // " " → "T"
    const d = new Date(isoLike);
    return isNaN(d.getTime()) ? null : d;
  }

  // 2) timetz("HH:mm[:ss][+09[:00]]" 또는 "오전/오후 HH:mm[:ss]") 형식이면 기존 로직으로
  const t = _timetzToTodayISO(s);
  return t;
}

// movement별 최신 1개 timetz를 조회해 'Date 객체'(KST 오늘 날짜와 결합)로 반환
async function _getLatestUpdateISO(movement) {
  try {
    const { data, error } = await supabase
      .from('update_log')
      .select('imDae_sheet_timetz')
      .eq('memo', '업데이트성공')
      .eq('movement', movement)
      .order('imDae_sheet_timetz', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    
    const t = data?.imDae_sheet_timetz ?? null;
    return t ? _parseUpdateLogTime(t) : null;

  } catch (e) {
    console.warn('update_log 조회 실패:', e);
    return null;
  }
}

// === 직원 사이드바 렌더 ===
async function renderStaffSidebar(me) {
  // 1) 직원 목록 로드 (권한별 재직자 필터)
  let staffQuery = supabase
    .from('staff_profiles')
    .select('id, name, affiliation, leave_date, ad_channel, extension')
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
    (data || []).forEach(({ id, name, affiliation, leave_date, ad_channel, extension  }) => {
        if (!grouped[affiliation]) grouped[affiliation] = { active: [], inactive: [] };
        const entry = { id, name, affiliation, leave_date, ad_channel, extension  };
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
    header.dataset.aff = aff; // 조회용 데이터 속성
    header.innerHTML = `${aff} <span class="aff-count" data-loading="1">...</span>`;


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
          __selectedChannel = null;
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
    // 직원 1명에 대해 채널을 ','로 분리해 여러 .name-item을 생성
    const createNameItems = (emp, { dim = false } = {}) => {
      const channels = _splitChannels(emp.ad_channel);
      const items = [];

      // 채널이 하나도 없으면 기존 방식처럼 1행 생성(채널표기는 생략)
      const targetChannels = channels.length ? channels : [null];

      targetChannels.forEach((ch) => {
        const el = document.createElement('div');
        el.className = 'name-item';
        // staffId를 문자열로 고정하고, dataset과 속성 모두에 써서 선택자 안정성 확보
        el.dataset.staffId = String(emp.id);
        el.setAttribute('data-staff-id', String(emp.id));
        el.dataset.branch = emp.affiliation || '';
        el.dataset.channel = ch ? ch : ''; // 채널 없으면 공백
        el.dataset.extension = (emp.extension || '').toString();

        // 표기: "이름 (채널)" — 채널 없으면 괄호 생략
        let displayName = dim ? `${emp.name} (퇴사)` : emp.name;
        if (ch) displayName += ` (${ch})`;

        el.innerHTML = `${displayName} <span class="ad-count" data-loading="1">...</span>`;

        // 권한별 클릭 허용
        const allowed = canClickStaff(emp);
        if (!allowed) {
          el.classList.add('opacity-50', 'pointer-events-none', 'select-none');
          el.dataset.disabled = '1';
        } else {
          el.classList.add('cursor-pointer', 'hover:bg-yellow-100');
          if (!firstClickableStaffEl) firstClickableStaffEl = el;
        }

        // 퇴사자 표기 스타일
        if (dim) {
          el.classList.add('text-gray-400', 'italic');
        }

        items.push(el);
      });

      return items;
    };

    // 활성(재직) 직원 렌더: 직원 1명 → 채널 개수만큼 줄 생성
    active.forEach((emp) => {
      const els = createNameItems(emp);
      els.forEach((el) => container.appendChild(el));
    });

    // --- 퇴사자 토글(관리자/지점장만 노출) ---
    if (me.authority !== '직원' && inactive.length > 0) {
      const toggleBtn = document.createElement('button');
      toggleBtn.textContent = '▼ 퇴사자 보기';
      toggleBtn.className = 'text-sm text-blue-600 hover:underline ml-2 mb-1';

      const collapseDiv = document.createElement('div');
      collapseDiv.className = 'pl-4 mt-1 hidden';
      collapseDiv.id = `inactive-group-${idx}`;

      // 퇴사자도 채널 분리하여 여러 줄 생성 (클릭은 비활성)
      inactive.forEach((emp) => {
        const els = createNameItems(emp, { dim: true });
        els.forEach((el) => {
          // 퇴사자는 항상 클릭 불가
          el.classList.add('opacity-60', 'pointer-events-none', 'select-none');
          collapseDiv.appendChild(el);
        });
      });

      toggleBtn.onclick = () => {
        const isHidden = collapseDiv.classList.toggle('hidden');
        toggleBtn.textContent = isHidden ? '▼ 퇴사자 보기' : '▲ 퇴사자 숨기기';
      };

      container.appendChild(toggleBtn);
      container.appendChild(collapseDiv);
    }

  });

  // 4-2) 좌측 목록의 각 지점별 전체 광고 개수 채우기
  await fillAffAdCounts(container);

  // 4-3) 좌측 목록의 각 직원별 광고 개수 채우기
  await fillStaffAdCounts(container);

  // 5) 직원 클릭 핸들러(단일 직원 필터 + 매물 조회/렌더)
    container.addEventListener('click', async (e) => {
        const el = e.target.closest('.name-item');
        if (!el || el.dataset.disabled === '1') return;

        // 선택 강조(직원 + 채널 단일 줄만 강조)
        setActiveStaff(container, el.dataset.staffId, el.dataset.channel);

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
            const staffExtRaw = (el.dataset.extension || '');      // ✅ 선택 직원 extension(원문)
            const staffExtCmp = staffExtRaw.replace(/\s+/g, ''); 
            const { data, error } = await supabase
              .from('ad_baikuk_listings')
              .select('contact_number, maintenance_cost, ad_restroom, ad_listing_id, description_listing_id, ad_loan, ad_premium, ad_deposit_price, ad_monthly_rent, description_deposit_price, deposit_monthly_rent, ad_floor_info, ad_listings_features, ad_area, description_area_py, ad_deal_type, ad_sale_price')
              .eq('branch_name', branchName)
              .ilike('agent_name', likeValue);

            if (error) throw error;

            const rows = data || [];

            {
              const [maemulAt, adAt] = await Promise.all([
                _getLatestUpdateISO('매물장'),
                _getLatestUpdateISO('백억광고'),
              ]);

              const parts = [];
              // now = 현재 KST 기준 시간
              const now = new Date();

              // 매물장: 1시간 이상 차이 나면 빨간색
              if (maemulAt) {
                const diff = diffHours(now, maemulAt);
                const txt = `${formatDate(maemulAt)} (매물장)`;
                parts.push(wrapRedIf(diff >= 1, txt));
              }

              // 백억광고: 24시간 이상 차이 나면 빨간색
              if (adAt) {
                const diff = diffHours(now, adAt);
                const txt = `${formatDate(adAt)} (백억광고)`;
                parts.push(wrapRedIf(diff >= 24, txt));
              }

              // 🔴 여기만 변경: textContent → innerHTML
              meta.innerHTML = parts.length
                ? `최신 업데이트: ${parts.join(' / ')}`
                : '최신 업데이트 기록이 없습니다';
            }

            if (!rows.length) {
              resultBox.innerHTML = `<div style="padding:8px; color:#666;">조건에 맞는 매물이 없습니다.</div>`;
              return;
            }

            // ✅ 표 생성
            const table = document.createElement('table');
            table.className = 'w-max table-auto border-collapse border border-gray-300 text-sm whitespace-nowrap';
            table.innerHTML = `
            <thead class="bg-gray-100 sticky top-0 z-10">
                <tr>
                  <th class="border border-gray-300 px-3 py-2 text-left">네이버</th>
                  <th class="border border-gray-300 px-3 py-2 text-left">매물번호</th>
                  <th class="border border-gray-300 px-3 py-2 text-left">매물명</th>
                  <th class="border border-gray-300 px-3 py-2 text-left">타입</th>
                  <th class="border border-gray-300 px-3 py-2 text-left">거래상태</th>
                  <th class="border border-gray-300 px-3 py-2 text-left">매매가</th>
                  <th class="border border-gray-300 px-3 py-2 text-left">보증금</th>
                  <th class="border border-gray-300 px-3 py-2 text-left">월세</th>
                  <th class="border border-gray-300 px-3 py-2 text-left">권리금</th>
                  <th class="border border-gray-300 px-3 py-2 text-left">면적</th>
                  <th class="border border-gray-300 px-3 py-2 text-left">융자금</th>
                  <th class="border border-gray-300 px-3 py-2 text-left">관리비</th>
                  <th class="border border-gray-300 px-3 py-2 text-left">화장실</th>
                  <th class="border border-gray-300 px-3 py-2 text-left">전화번호</th>
                  <th class="border border-gray-300 px-3 py-2 text-left">매물특징</th>
                  <th class="border border-gray-300 px-3 py-2 text-left">해당층</th>
                  <th class="border border-gray-300 px-3 py-2 text-left">총층</th>
                </tr>
            </thead>
            <tbody></tbody>
            `;

            const tbody = table.querySelector('tbody');

            // 1) 필요한 description_listing_id만 수집
            const idList = Array.from(
              new Set(
                (rows || [])
                  .map(r => r?.description_listing_id)
                  .filter(v => v !== null && v !== undefined && v !== '')
              )
            );

            // 2) baikukdbtest에서 title + transaction_status 한 번에 조회
            let infoMap = {};
            if (idList.length > 0) {
              try {
                const { data: infoRows, error: infoErr } = await supabase
                  .from('baikukdbtest')
                  .select('listing_id, listing_title, transaction_status, premium_price, deposit_price, monthly_rent, floor, total_floors, sale_price, area_m2')
                  .in('listing_id', idList);
                if (infoErr) throw infoErr;

                infoMap = Object.fromEntries(
                  (infoRows || []).map(r => [
                    String(r.listing_id),
                    {
                      title: r.listing_title || '-',
                      status: r.transaction_status || '-',
                      premium_price: r.premium_price,
                      deposit_price: r.deposit_price,
                      monthly_rent: r.monthly_rent,
                      floor: r.floor ?? '',
                      total_floors: r.total_floors ?? '',
                      sale_price: r.sale_price ?? '',
                      area_m2: r.area_m2 ?? ''   // ✅ 추가
                    }
                  ])
                );
              } catch (e) {
                console.warn('매물 정보 배치 조회 실패:', e);
              }
            }

            // 3) 정렬 키 계산 → 정렬 → 행 렌더링
            const enriched = (rows || []).map((row, idx) => {
              const adId  = row.ad_listing_id ?? '-';
              const descId = row.description_listing_id ?? '-';

              const info = row.description_listing_id
                ? infoMap[String(row.description_listing_id)]
                : null;

              const title  = info?.title ?? '-';
              // 원본 상태값과 표시용(날짜 제거) 상태값 분리
              const statusRaw = info?.status ?? '-';
              const statusDisplay = _stripDateFromStatus(statusRaw);
              const premiumPrice = info?.premium_price;

              // === [해당층] 비교 ===
              // 1) 광고(ad_baikuk_listings) 측: ad_floor_info에서 '/' 앞부분만 추출하고 공백 제거
              const adFloorRaw = row.ad_floor_info ?? '';
              const adFloorFront = String(adFloorRaw).split('/')[0]?.replace(/\s+/g, '').trim();

              // 2) 기준(baikukdbtest) 측: floor에서 공백 제거
              const baseFloorRaw = info?.floor ?? '';
              const baseFloorNorm = String(baseFloorRaw).replace(/\s+/g, '').trim();

              // === [총층] 비교 ===
              // 1) 광고(ad_baikuk_listings): ad_floor_info에서 '/' 뒤쪽만 추출하고 공백 제거
              const adTotalRaw = row.ad_floor_info ?? '';
              const adTotalBack = String(adTotalRaw).includes('/')
                ? String(adTotalRaw).split('/')[1]?.replace(/\s+/g, '').trim()
                : '';

              // ================================
              // 🔍 ad_floor_info 예외 처리 추가
              // 앞(해당층) 값이 뒤(총층)보다 크면 서로 뒤바꿀 것
              // ================================
              let adFloor = adFloorFront;
              let adTotal = adTotalBack;

              if (
                adFloor &&
                adTotal &&
                !isNaN(Number(adFloor)) &&
                !isNaN(Number(adTotal)) &&
                Number(adFloor) > Number(adTotal)
              ) {
                const tmp = adFloor;
                adFloor = adTotal;  // 총층
                adTotal = tmp;      // 해당층
              }

              // 2) 기준(baikukdbtest): total_floors에서 공백 제거
              const baseTotalRaw = info?.total_floors ?? '';
              const baseTotalNorm = String(baseTotalRaw).replace(/\s+/g, '').trim();

              // === [면적] 비교 ===
              // 월세일 때만 적용
              let areaCell = row.ad_area ?? '-';
              if (row.ad_deal_type && row.ad_deal_type.includes('월세')) {
                // 광고측 ad_area: '/' 기준 오른쪽 값(없으면 전체)
                const adAreaRaw = row.ad_area ?? '';
                const adAreaRight = String(adAreaRaw).includes('/')
                  ? String(adAreaRaw).split('/')[1].trim()
                  : String(adAreaRaw).trim();
                const adAreaNum = _normMoney(adAreaRight);

                // 기준값: baikukdbtest.area_m2
                const baseAreaRaw = info?.area_m2 ?? '';
                const baseAreaNum = _normMoney(baseAreaRaw);

                // 1) 광고값 vs area_m2 다르면 → '면적 확인' (빨간)
                const needAreaCheck =
                  adAreaNum !== null && baseAreaNum !== null && Math.abs(adAreaNum - baseAreaNum) >= 6;

                // 2) 광고값 vs (description_area_py ÷ 0.3025) 6㎡ 이상 차이면 → '상세설명' (빨간)
                const descAreaPy = _normMoney(row.description_area_py);
                const descAreaM2 = descAreaPy !== null ? descAreaPy / 0.3025 : null;
                const needAreaDescBadge =
                  adAreaNum !== null && descAreaM2 !== null && Math.abs(adAreaNum - descAreaM2) >= 6;

                // 출력 우선순위 ...
                let areaOut = needAreaCheck
                  ? '<span class="text-red-600 font-semibold">면적 확인</span>'
                  : (adAreaRight || (baseAreaRaw ? String(baseAreaRaw) : '-'));

                if (needAreaDescBadge) {
                  areaOut = `${areaOut !== '-' ? areaOut + '<br>' : ''}<span class="text-red-600 font-semibold">상세설명</span>`;
                }

                areaCell = areaOut;
              }

              // === [매매가] 비교 ===
              let salePriceLabel = '-';
              if (row.ad_deal_type && row.ad_deal_type.includes('매매')) {
                const adSale = _normMoney(row.ad_sale_price);
                const baseSale = _normMoney(info?.sale_price);

                if (adSale !== null && baseSale !== null && adSale !== baseSale) {
                  salePriceLabel = '<span class="text-red-600 font-semibold">매매가 확인</span>';
                } else if (adSale !== null) {
                  salePriceLabel = adSale.toLocaleString();
                } else if (baseSale !== null) {
                  salePriceLabel = baseSale.toLocaleString();
                }
              }

              // ✅ 보증금/월세 표시값: ad_* (현재) vs baikukdbtest.* (기준) 비교
              let depositLabel = row.ad_deposit_price ?? '-';
              if (row.ad_deal_type && row.ad_deal_type.includes('월세')) {
                depositLabel = _compareMoney(row.ad_deposit_price, info?.deposit_price, '보증금 확인');
              }
              let monthlyLabel = row.ad_monthly_rent ?? '-';
              if (row.ad_deal_type && row.ad_deal_type.includes('월세')) {
                monthlyLabel = _compareMoney(row.ad_monthly_rent, info?.monthly_rent, '월세 확인');
              }

              // === [관리비] 표시 ===
              // 규칙:
              //  - '/' 기준 앞부분만 사용
              //  - 공백 제거 + '만원' 제거
              //  - 숫자 변환 후 2 미만이면 '관리비 체크'(빨강)
              let maintenanceLabel = '-';
              if (row.maintenance_cost !== undefined && row.maintenance_cost !== null) {
                const raw = String(row.maintenance_cost).split('/')[0] || '';
                const cleaned = raw.replace(/\s+/g, '').replace(/만원/g, '');
                const num = Number(cleaned);

                if (!isNaN(num)) {
                  if (num < 1) {
                    maintenanceLabel = '<span class="text-red-600 font-semibold">관리비 체크</span>';
                  } else if (num < 2) {
                    maintenanceLabel = '<span class="font-semibold">관리비 체크</span>';
                  } else {
                      maintenanceLabel = num.toLocaleString();
                    }
                }
                else {
                  maintenanceLabel = '-';
                }
              }

              // === [화장실] 표시 ===
              // 규칙: ad_restroom 값을 '/' 기준으로 오른쪽 문자열을 추출해 그 안에 '0'이 포함되면
              //      빨간 '화장실 확인', 아니면 '-'
              let restroomLabel = '-';
              const rrRaw = row.ad_restroom ?? '';
              const rrRight = String(rrRaw).includes('/')
                ? String(rrRaw).split('/')[1].trim()
                : '';
              if (rrRight.includes('0')) {
                restroomLabel = '<span class="text-red-600 font-semibold">화장실 확인</span>';
              }

              // 표시값 계산
              const loanLabel = (row.ad_loan === 0) ? '융자금 없음' : (row.ad_loan ?? '-');

              let premiumLabel = '-';
              if (row.ad_deal_type && row.ad_deal_type.includes('월세')) {
                if (premiumPrice !== undefined) {
                  if (row.ad_premium === "없음" && Number(premiumPrice) >= 1) {
                    premiumLabel = '권리금 없음';
                  } else {
                    premiumLabel = premiumPrice;
                  }
                }
              }

              // === [전화번호] 표시 ===
              // 규칙:
              //  - ad_baikuk_listings.contact_number(광고 원문)과 staff_profiles.extension(선택 직원) 비교
              //  - 비교 시 공백 제거
              //  - 둘 다 값이 있고 서로 다르면 '불일치'(빨강)
              //  - 그 외에는 광고 contact_number 원문을 그대로 표시, 값 없으면 '-'
              const contactRaw = row.contact_number ?? '';
              const contactCmp = String(contactRaw).replace(/\s+/g, '');
              let phoneCell = '-';
              if (contactCmp && staffExtCmp) {
                phoneCell = (contactCmp === staffExtCmp)
                  ? '-'
                  : '<span class="text-red-600 font-semibold">불일치</span>';
              } else if (contactCmp) {
                phoneCell = String(contactRaw);
              }

              // 매물특징 표시 정책 확장
              // - 비정상(미입력/빈값/'-') → '미노출'(빨강)
              // - 정상(값 존재) → '-'
              // - 단, premium_price === 0 && '완비' 포함 시 '시설체크'(빨강) 추가
              const rawFeat = (row.ad_listings_features ?? '').trim();
              const hasFeature = !!rawFeat && rawFeat !== '-';

              let featuresLabel = hasFeature
                ? '-'  // 정상일 때 기본값은 '-'
                : '<span class="text-red-600 font-semibold">미노출</span>';

              // ✅ 시설체크 조건 (기준: baikukdbtest.premium_price)
              if (premiumPrice === 0 && rawFeat.includes('완비')) {
                if (featuresLabel.includes('미노출')) {
                  featuresLabel += '<br><span class="font-semibold">시설체크</span>';
                } else {
                  featuresLabel = '<span class="font-semibold">시설체크</span>';
                }
              }

              // 출력 라벨이 빈 문자열이라면 '-'로 표시
              const baseDepositOut = depositLabel && depositLabel.length ? depositLabel : '-';
              const baseMonthlyOut = monthlyLabel && monthlyLabel.length ? monthlyLabel : '-';

              // ✅ (보증금) ad_baikuk_listings.description_deposit_price vs ad_deposit_price 비교
              const adDepNorm   = _normMoney(row.ad_deposit_price);
              const descDepNorm = _normMoney(row.description_deposit_price);
              const needDepositDescBadge = (adDepNorm !== null && descDepNorm !== null && adDepNorm !== descDepNorm);

              // ✅ (보증금) 다르면 줄바꿈 + '상세설명'(빨강) 추가
              const depositOut = needDepositDescBadge
                ? `${baseDepositOut !== '-' ? baseDepositOut + '<br>' : ''}<span class="text-red-600 font-semibold">상세설명</span>`
                : baseDepositOut;

              // ✅ (월세) ad_baikuk_listings.deposit_monthly_rent vs ad_monthly_rent 비교
              const adMonNorm   = _normMoney(row.ad_monthly_rent);
              const descMonNorm = _normMoney(row.deposit_monthly_rent);
              const needMonthlyDescBadge = (adMonNorm !== null && descMonNorm !== null && adMonNorm !== descMonNorm);

              // ✅ (월세) 다르면 줄바꿈 + '상세설명'(빨강) 추가
              const monthlyOut = needMonthlyDescBadge
                ? `${baseMonthlyOut !== '-' ? baseMonthlyOut + '<br>' : ''}<span class="text-red-600 font-semibold">상세설명</span>`
                : baseMonthlyOut;

              // === 정렬 우선순위 계산 (요청 순서 그대로) ===

              // 1) 매물번호 '-'
              const descPriority = (descId === '-') ? 0 : 1;

              // 2) 매물명 '-'
              const titlePriority = (title === '-') ? 0 : 1;

              // 3) 거래상태: '-', '0', '계약완료', '보류', 기타
              const s = (statusDisplay || '').toString().trim();
              let statusPriority = 99;
              if (s === '-') statusPriority = 0;
              else if (s === '0') statusPriority = 1;
              else if (s.includes('계약완료')) statusPriority = 2;
              else if (s.includes('보류')) statusPriority = 3;
              else statusPriority = 4;

              // 4) 매매가: '매매가 확인' 포함 우선
              const salePriority = (String(salePriceLabel).includes('매매가 확인')) ? 0 : 1;

              // 5) 보증금: '보증금 확인' → '상세설명' → 기타
              let depositPriority = 2;
              if (String(depositOut).includes('보증금 확인')) depositPriority = 0;
              else if (String(depositOut).includes('상세설명')) depositPriority = 1;

              // 6) 월세: '월세 확인' → '상세설명' → 기타
              let monthlyPriority = 2;
              if (String(monthlyOut).includes('월세 확인')) monthlyPriority = 0;
              else if (String(monthlyOut).includes('상세설명')) monthlyPriority = 1;

              // 7) 권리금: '권리금 없음' 우선
              const premiumPriority = (premiumLabel === '권리금 없음') ? 0 : 1;

              // 8) 면적: '면적 확인' → '상세설명' → 기타
              let areaPriority = 2;
              if (String(areaCell).includes('면적 확인')) areaPriority = 0;
              else if (String(areaCell).includes('상세설명')) areaPriority = 1;

              // 9) 융자금: '융자금 없음' 우선
              const loanPriority = (loanLabel === '융자금 없음') ? 0 : 1;

              // 10) 관리비: '관리비 체크' 포함 우선
              const manageFeePriority = (String(maintenanceLabel).includes('관리비 체크')) ? 0 : 1;

              // 11) 화장실: '화장실 확인' 포함 우선
              const restroomPriority = (String(restroomLabel).includes('화장실 확인')) ? 0 : 1;

              // 12) 전화번호: '불일치' 포함 우선
              const phonePriority = (String(phoneCell).includes('불일치')) ? 0 : 1;

              // 13) 매물특징: '미노출' → '시설체크' → 기타
              let featuresPriority = 2;
              if (String(featuresLabel).includes('미노출')) featuresPriority = 0;
              else if (String(featuresLabel).includes('시설체크')) featuresPriority = 1;

              // 14) 해당층: '해당층 확인' 포함 우선
              const floorPriority = (String(floorCell).includes('해당층 확인')) ? 0 : 1;

              // 15) 총층: '총층 확인' 포함 우선
              const totalFloorPriority = (String(totalFloorCell).includes('총층 확인')) ? 0 : 1;

              // 최종 sortKey: 요청 조건 순서대로
              const sortKey = [
                descPriority,
                titlePriority,
                statusPriority,
                salePriority,
                depositPriority,
                monthlyPriority,
                premiumPriority,
                areaPriority,
                loanPriority,
                manageFeePriority,
                restroomPriority,
                phonePriority,
                featuresPriority,
                floorPriority,
                totalFloorPriority,
                idx // 안정정렬
              ];

              return {
                adId,
                descId,
                title,
                statusDisplay,
                floorCell,
                totalFloorCell,
                areaCell,
                dealType: row.ad_deal_type ?? '-',
                depositLabel: depositOut,
                monthlyLabel: monthlyOut,
                premiumLabel,
                loanLabel,
                maintenanceLabel,
                restroomLabel,
                featuresLabel,
                salePriceLabel,
                phoneCell,
                sortKey
              };
            });

            // 우선순위대로 정렬
            enriched.sort((a, b) => {
              for (let i = 0; i < a.sortKey.length; i++) {
                if (a.sortKey[i] !== b.sortKey[i]) return a.sortKey[i] - b.sortKey[i];
              }
              return 0;
            });

            enriched.forEach(item => {
              const tr = document.createElement('tr');

              // 네이버/백억 링크용 URL
              const noId = (item.descId === '-' || item.descId === '매물번호 없음');
              const noAdId = (item.adId === '-' || item.adId === '매물번호 없음');

              const naverUrl = `https://new.land.naver.com/offices?ms=37.7284146,126.734902,18&articleNo=${item.adId}`;
              const baikukUrl = `https://baikuk.com/item/view/${item.descId}`;

              // 1) 네이버 열: adId 표시 + 네이버 링크 (초록색)
              const naverCell = noAdId
                ? '<span class="text-red-600 font-semibold">매물번호 없음</span>'
                : `<a href="${naverUrl}" target="_blank" rel="noopener noreferrer" class="hover:underline text-green-600">${item.adId}</a>`;

              // 2) 매물번호 열: descId 표시 + 백억 링크 (파란색)
              const descCell = noId
                ? '<span class="text-red-600 font-semibold">매물번호 없음</span>'
                : `<a href="${baikukUrl}" target="_blank" rel="noopener noreferrer" class="hover:underline text-blue-600">${item.descId}</a>`;

              // 거래상태: '계약완료' 또는 '보류'면 빨간색 표시 (날짜 제거된 표시값 기준)
              const statusCell = (item.statusDisplay.includes('계약완료') || item.statusDisplay.includes('보류'))
                ? `<span class="text-red-600 font-semibold">${item.statusDisplay}</span>`
                : item.statusDisplay;

              // 권리금: '권리금 없음' → 빨간색
              const premiumCell = (item.premiumLabel === '권리금 없음')
                ? `<span class="text-red-600 font-semibold">${item.premiumLabel}</span>`
                : item.premiumLabel;

              // 융자금: '융자금 없음' → 빨간색
              const loanCell = (item.loanLabel === '융자금 없음')
                ? `<span class="text-red-600 font-semibold">${item.loanLabel}</span>`
                : item.loanLabel;

              tr.innerHTML = `
                <td class="border border-gray-300 px-3 py-1">${naverCell}</td>
                <td class="border border-gray-300 px-3 py-1">${descCell}</td>
                <td class="border border-gray-300 px-3 py-1">
                  <div class="w-[10rem] overflow-hidden text-ellipsis whitespace-nowrap [text-wrap:balance] break-all" title="${item.title}">
                    ${item.title}
                  </div>
                </td>
                <td class="border border-gray-300 px-3 py-1">${item.dealType}</td>
                <td class="border border-gray-300 px-3 py-1">${statusCell}</td>
                <td class="border border-gray-300 px-3 py-1">${item.salePriceLabel}</td>
                <td class="border border-gray-300 px-3 py-1">${item.depositLabel}</td>
                <td class="border border-gray-300 px-3 py-1">${item.monthlyLabel}</td>
                <td class="border border-gray-300 px-3 py-1">${premiumCell}</td>
                <td class="border border-gray-300 px-3 py-1">${item.areaCell}</td>
                <td class="border border-gray-300 px-3 py-1">${loanCell}</td>
                <td class="border border-gray-300 px-3 py-1">${item.maintenanceLabel}</td>
                <td class="border border-gray-300 px-3 py-1">${item.restroomLabel}</td>
                <td class="border border-gray-300 px-3 py-1">${item.phoneCell}</td>
                <td class="border border-gray-300 px-3 py-1">${item.featuresLabel}</td>
                <td class="border border-gray-300 px-3 py-1">${item.floorCell}</td>
                <td class="border border-gray-300 px-3 py-1">${item.totalFloorCell}</td>
              `;
              tbody.appendChild(tr);
            });

            resultBox.appendChild(table);

            {
              const [maemulAt, adAt] = await Promise.all([
                _getLatestUpdateISO('매물장'),
                _getLatestUpdateISO('백억광고'),
              ]);

              const parts = [];
              // now = 현재 KST 기준 시간
              const now = new Date();

              // 매물장: 1시간 이상 차이 나면 빨간색
              if (maemulAt) {
                const diff = diffHours(now, maemulAt);
                const txt = `${formatDate(maemulAt)} (매물장)`;
                parts.push(wrapRedIf(diff >= 1, txt));
              }

              // 백억광고: 24시간 이상 차이 나면 빨간색
              if (adAt) {
                const diff = diffHours(now, adAt);
                const txt = `${formatDate(adAt)} (백억광고)`;
                parts.push(wrapRedIf(diff >= 24, txt));
              }

              // 🔴 여기만 변경: textContent → innerHTML
              meta.innerHTML = parts.length
                ? `최신 업데이트: ${parts.join(' / ')}`
                : '최신 업데이트 기록이 없습니다';
            }

        } catch (err) {
            console.error(err);
            meta.textContent = '매물 조회 중 오류가 발생했습니다.';
            resultBox.innerHTML = '';
        }
    });

  // 6) UX: 누구든(관리자/지점장/직원) 본인 항목이 보이면 자동 선택(조회까지 실행)
  //    - 본인 항목이 없거나 클릭 불가면 첫 번째 클릭 가능 항목을 클릭
  //    - 마지막 안전망: 패널만 열고 안내
  if (me.staffId) {
    const idStr = String(me.staffId);

    // 내 항목 중 클릭 가능한 첫 줄(채널 분리된 여러 줄 중) 찾기
    const myEl = container.querySelector(`.name-item[data-staff-id="${idStr}"]:not([data-disabled="1"])`);

    if (myEl) {
      myEl.click(); // 하이라이트 + 조회
    } else if (firstClickableStaffEl) {
      firstClickableStaffEl.click(); // 대체: 첫 클릭 가능 항목 조회
    } else {
      const panel = document.getElementById('employee-listings-panel');
      const meta = document.getElementById('employee-listings-meta');
      const resultBox = document.getElementById('employee-listings');
      if (panel && meta && resultBox) {
        panel.style.display = '';
        meta.textContent = '선택 가능한 직원 항목이 없습니다.';
        resultBox.innerHTML = '';
      }
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
      location.replace('https://baikuk-map.netlify.app/admin/listings/');
      return;
    }
  } catch (e) {
    console.warn(e);
  }

  // 내 권한/소속/ID 파악 후 사이드바 렌더
  const me = await getMyAuthorityAndStaffId();
  await renderStaffSidebar(me);

  // ✅ 정산 탭 표시/숨김을 여기서 최종 결정
  const tab = document.getElementById('settlement-tab');
  if (tab) {
    if (me.isStaff) {
      tab.style.display = 'none';           // 직원: 계속 숨김
    } else {
      tab.style.removeProperty('display');  // 관리자/지점장: 보이기
    }
  }
}