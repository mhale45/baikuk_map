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

// [RESTORE] 금액 파싱/비교 유틸
function _normMoney(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
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
            .select('ad_listing_id, description_listing_id, ad_loan, ad_premium, ad_deposit_price, ad_monthly_rent')
            .eq('branch_name', branchName)
            .ilike('agent_name', likeValue);

            if (error) throw error;

            const rows = data || [];
            meta.innerHTML = `<strong>${branchName}</strong> · <strong>${channel}</strong> : <strong>${rows.length}</strong>건`;

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
                  <th class="border border-gray-300 px-3 py-2 text-left">매물명</th>
                  <th class="border border-gray-300 px-3 py-2 text-left">거래상태</th>
                  <th class="border border-gray-300 px-3 py-2 text-left">보증금</th>
                  <th class="border border-gray-300 px-3 py-2 text-left">월세</th>
                  <th class="border border-gray-300 px-3 py-2 text-left">권리금</th>
                  <th class="border border-gray-300 px-3 py-2 text-left">융자금</th>
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
                  .select('listing_id, listing_title, transaction_status, premium_price, deposit_price, monthly_rent')
                  .in('listing_id', idList);

                if (infoErr) throw infoErr;

                infoMap = Object.fromEntries(
                  (infoRows || []).map(r => [
                    String(r.listing_id),
                    {
                      title: r.listing_title || '-',
                      status: r.transaction_status || '-',
                      premium_price: r.premium_price,
                      deposit_price: r.deposit_price,      // ✅ 보증금 기준값
                      monthly_rent: r.monthly_rent         // ✅ 월세 기준값
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
              const status = info?.status ?? '-';
              const premiumPrice = info?.premium_price;

              // ✅ 보증금/월세 표시값: ad_* (현재) vs baikukdbtest.* (기준) 비교
              const depositLabel = _compareMoney(row.ad_deposit_price, info?.deposit_price, '보증금 확인');
              const monthlyLabel = _compareMoney(row.ad_monthly_rent,  info?.monthly_rent,  '월세 확인');

              // 표시값 계산
              const loanLabel = (row.ad_loan === 0) ? '융자금 없음' : (row.ad_loan ?? '-');

              let premiumLabel = '-';
              if (premiumPrice !== undefined) {
                if (row.ad_premium === 0 && Number(premiumPrice) >= 1) {
                  premiumLabel = '권리금 없음';
                } else {
                  premiumLabel = premiumPrice;
                }
              }

              // 정렬 우선순위 계산
              // 0) 매물번호(descId)가 '-' 인 항목 최우선
              const descPriority = (descId === '-') ? 0 : 1;

              // 1) 매물명(title)이 '-' 인 항목 우선
              const titlePriority = (title === '-') ? 0 : 1;

              // 2) 거래상태 세부 우선순위 (부분일치 적용)
              const s = (status ?? '').toString().trim();
              let statusPriority = 99;

              if (s === '-') {
                statusPriority = 0;                              // 상태 없음
              } else if (s.includes('0')) {
                statusPriority = 1;                              // '0', '0번', '0상태' 등 포함
              } else if (s.includes('계약완료') || s.includes('거래완료')) {
                statusPriority = 2;                              // '계약완료', '계약완료 1234', '거래완료' 등
              } else if (s.includes('보류')) {
                statusPriority = 3;                              // '보류', '보류 처리', '보류 1차' 등
              } else {
                statusPriority = 4;                              // 진행중 및 기타 상태
              }

              // 숫자 기준으로 판정 (라벨은 출력용)
              const depC = _normMoney(row.ad_deposit_price);
              const depB = _normMoney(info?.deposit_price);
              const monC = _normMoney(row.ad_monthly_rent);
              const monB = _normMoney(info?.monthly_rent);

              const isDepositCheck = (depC !== null && depB !== null && depC !== depB);
              const isMonthlyCheck = (monC !== null && monB !== null && monC !== monB);

              // 3) 보증금: '보증금 확인' → '-' 우선
              let depositPriority = 2;
              if (isDepositCheck) depositPriority = 0;
              else if (depC === null) depositPriority = 1;

              // 4) 월세: '-' → '월세 확인' 우선
              let monthlyPriority = 2;
              if (monC === null) monthlyPriority = 0;
              else if (isMonthlyCheck) monthlyPriority = 1;

              // 5) 권리금: '권리금 없음' 우선
              const premiumPriority = (premiumLabel === '권리금 없음') ? 0 : 1;

              // 6) 융자금: '융자금 없음' 우선
              const loanPriority = (loanLabel === '융자금 없음') ? 0 : 1;

              // 최종 sortKey (요청하신 우선순위 순서대로)
              const sortKey = [
                descPriority,     // 매물번호 '-'
                titlePriority,    // 매물명 '-'
                statusPriority,   // 거래상태 '-', '0', '거래완료', '보류', 기타
                depositPriority,  // 보증금 '보증금 확인' → '-'
                monthlyPriority,  // 월세 '-' → '월세 확인'
                premiumPriority,  // 권리금 '권리금 없음'
                loanPriority,     // 융자금 '융자금 없음'
                idx               // 안정적 정렬 보조
              ];

              // 출력 라벨이 빈 문자열이라면 '-'로 표시
              const depositOut = depositLabel && depositLabel.length ? depositLabel : '-';
              const monthlyOut = monthlyLabel && monthlyLabel.length ? monthlyLabel : '-';

              return { adId, descId, title, status, depositLabel: depositOut, monthlyLabel: monthlyOut, premiumLabel, loanLabel, sortKey };
            });

            // 우선순위대로 정렬
            enriched.sort((a, b) => {
              for (let i = 0; i < a.sortKey.length; i++) {
                if (a.sortKey[i] !== b.sortKey[i]) return a.sortKey[i] - b.sortKey[i];
              }
              return 0;
            });

            // 렌더링
            enriched.forEach(item => {
              const tr = document.createElement('tr');
              
              // 네이버/자체 링크용 URL 생성
              const naverUrl = `https://new.land.naver.com/offices?ms=37.7284146,126.734902,18&articleNo=${item.descId}`;
              const baikukUrl = `https://baikuk.com/item/view/${item.descId}`;

              // 매물번호가 '-'이면 빨간색 "매물번호 없음" 표시
              const descCell = (item.descId === '-' || item.descId === '매물번호 없음')
                ? '<span class="text-red-600 font-semibold">매물번호 없음</span>'
                : `
                  <a href="${naverUrl}" target="_blank" class="text-blue-600 hover:underline mr-2">${item.descId} (네이버)</a>
                  <a href="${baikukUrl}" target="_blank" class="text-green-600 hover:underline">${item.descId} (백억)</a>
                `;

              tr.innerHTML = `
                <td class="border border-gray-300 px-3 py-1">${item.adId}</td>
                <td class="border border-gray-300 px-3 py-1">${descCell}</td>
                <td class="border border-gray-300 px-3 py-1">${item.title}</td>
                <td class="border border-gray-300 px-3 py-1">${item.status}</td>
                <td class="border border-gray-300 px-3 py-1">${item.depositLabel}</td>
                <td class="border border-gray-300 px-3 py-1">${item.monthlyLabel}</td>
                <td class="border border-gray-300 px-3 py-1">${item.premiumLabel}</td>
                <td class="border border-gray-300 px-3 py-1">${item.loanLabel}</td>
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
