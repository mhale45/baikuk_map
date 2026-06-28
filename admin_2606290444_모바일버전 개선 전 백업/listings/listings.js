import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.3/+esm';
import { renderSidebar } from '../../modules/ui/sidebar.js';

// 사이드바 렌더링
renderSidebar('listings');

const client = createClient(
  'https://sfinbtiqlfnaaarziixu.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmaW5idGlxbGZuYWFhcnppaXh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI1MDkxNjEsImV4cCI6MjA2ODA4NTE2MX0.4-7vnIjbF-biWWuv9-vTxK9Y99gMm-vS6oaRMdRL5fA'
);

// ✅ 세션 체크: 없으면 로그인 폼을 '항상' 띄우고, 성공 시 이 페이지 로드
(async () => {
  try {
    const { data: { session } } = await client.auth.getSession();

    if (!session) {
      // 앱 본체 로직 중단 플래그
      window.__BLOCK_APP__ = true;

      const $screen = document.getElementById('auth-screen');
      const $email  = document.getElementById('auth-email');
      const $pw     = document.getElementById('auth-password');
      const $login  = document.getElementById('auth-login');
      const $close  = document.getElementById('auth-close');
      const $err    = document.getElementById('auth-error');

      // 로그인 화면 보이기
      $screen?.classList.remove('hidden');

      const showError = (msg) => {
        if ($err) {
          $err.textContent = String(msg || '로그인 실패');
          $err.classList.remove('hidden');
        }
      };

      // 🔐 로그인 처리 함수
      const doLogin = async () => {
        try {
          $login.disabled = true;
          $login.textContent = '로그인 중...';
          $err?.classList.add('hidden');

          // 1) 이메일/비번 로그인
          const { error } = await client.auth.signInWithPassword({
            email: ($email?.value || '').trim(),
            password: ($pw?.value || '').trim()
          });
          if (error) throw error;

          // 2) (선택) 세션 등록 / 허용 검사  👉 체이닝 .catch 제거 & try/catch 사용
          try {
            await client.rpc('register_session', {
              device_label: (navigator.platform + ' ' + (navigator.vendor || '')).trim(),
              user_agent: navigator.userAgent
            });
          } catch (_) { /* ignore */ }

          let allowed = true;
          try {
            const { data } = await client.rpc('is_session_allowed');
            if (data === false) allowed = false;
          } catch (_) { /* 서버 함수 없으면 통과 */ }

          if (!allowed) {
            await client.auth.signOut();
            throw new Error('허용된 기기 수를 초과했습니다. 다른 기기에서 로그아웃 후 다시 시도해 주세요.');
          }

          // 3) ✅ 리다이렉트만! (reload 제거)
          location.replace('https://baikuk-map.netlify.app/admin/listings/');

        } catch (e) {
          $err.textContent = e?.message || '로그인 실패';
          $err.classList.remove('hidden');
          $login.disabled = false;
          $login.textContent = '로그인';
        }
      };

      // 이벤트 바인딩
      $login && ($login.onclick = doLogin);
      $close && ($close.onclick = () => location.replace('https://baikuk.com/map'));
      [$email, $pw].forEach(inp => {
        inp && inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') doLogin();
        });
      });

      // 세션 없으면 여기서 종료 (앱 로직 실행 안 함)
      return;
    }

    // 세션이 있으면 앱 로직 실행 허용
    window.__BLOCK_APP__ = false;
  } catch (e) {
    console.warn('세션 확인 중 예외:', e);
    // 예외 시에도 로그인 화면 띄워서 사용자 동작 허용
    window.__BLOCK_APP__ = true;
    document.getElementById('auth-screen')?.classList.remove('hidden');
  }
})();

// ✅ 대체안: 'SIGNED_IN'에서만 1회 동작
client.auth.onAuthStateChange((evt, session) => {
  if (evt === 'SIGNED_IN' && session && !window.__did_redirect__) {
    window.__did_redirect__ = true; // 중복 방지
    // 필요 없으면 이 줄도 생략 가능 (우리는 B에서 명시 리다이렉트)
    // location.replace('https://baikuk-map.netlify.app/admin/listings/');
  }
});

const formatNumber = val => val != null ? Number(val).toLocaleString('ko-KR') : '-';
const filterInputs = [
  { key: 'floor',         min: 'filter-floor-min',    max: 'filter-floor-max' },   // ⬅️ 추가
  { key: 'deposit_price', min: 'filter-deposit-min',  max: 'filter-deposit-max' },
  { key: 'monthly_rent',  min: 'filter-rent-min',     max: 'filter-rent-max' },
  { key: 'premium_price', min: 'filter-premium-min',  max: 'filter-premium-max' },
  { key: 'area_py',       min: 'filter-area-min',     max: 'filter-area-max' },
  { key: 'sale_price',    min: 'filter-sale-min',     max: 'filter-sale-max' },
  { key: 'roi',           min: 'filter-roi-min',      max: 'filter-roi-max' }
];

// 스크립트 시작부분
// ✅ admin URL을 항상 '/admin' 형태로 만들어 주는 헬퍼
function makeAdminUrl(params = {}) {
  const u = new URL('/admin', location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  });
  return u.pathname + u.search + u.hash; // '/admin?id=123' 형태 반환
}

// ✅ 혹시 '/admin.html?...'로 진입해도 한 번만 '/admin?...'로 정규화
(function normalizeAdminHtmlOnce() {
  if (location.pathname === '/admin.html') {
    const u = new URL(location.href);
    // /admin.html → /admin 로 교체 (쿼리/해시 유지)
    const clean = '/admin' + u.search + u.hash;
    // replace: 히스토리 남기지 않음, 무한루프 방지
    location.replace(clean);
  }
})();


function bindNumericFilterInputs() {
  filterInputs.forEach(({ key, min, max }) => {
    const minInput = document.getElementById(min);
    const maxInput = document.getElementById(max);
    if (!minInput || !maxInput) {
      console.warn(`필터 입력을 찾지 못했습니다: ${min}, ${max}`);
      return;
    }
    const updateFilter = () => {
      let minVal = parseFloat(minInput.value);
      let maxVal = parseFloat(maxInput.value);
      if (key === 'roi') {
        if (!Number.isNaN(minVal)) minVal = minVal / 100; // % → 소수
        if (!Number.isNaN(maxVal)) maxVal = maxVal / 100;
      }
      filterConditions[key] = {
        min: Number.isNaN(minVal) ? null : minVal,
        max: Number.isNaN(maxVal) ? null : maxVal
      };
    };
    minInput.addEventListener('blur', updateFilter);
    maxInput.addEventListener('blur', updateFilter);
  });
}


filterInputs.forEach(({ key, min, max }) => {
  const minInput = document.getElementById(min);
  const maxInput = document.getElementById(max);

  const updateFilter = () => {
    let minVal = parseFloat(minInput.value);
    let maxVal = parseFloat(maxInput.value);

    // ROI는 % 단위 입력 → 소수로 변환
    if (key === 'roi') {
      if (!Number.isNaN(minVal)) minVal = minVal / 100;
      if (!Number.isNaN(maxVal)) maxVal = maxVal / 100;
    }

    filterConditions[key] = {
      min: Number.isNaN(minVal) ? null : minVal,
      max: Number.isNaN(maxVal) ? null : maxVal
    };

    // 목록 즉시 반영 (원하면 주석 해제)
    // const final = applyAllFilters(listings);
    // rerender(final);
  };

  minInput.addEventListener('blur', updateFilter);
  maxInput.addEventListener('blur', updateFilter);
});

let listings = [], offset = 0, limit = 300, isLoading = false, hasMore = true;
let currentSort = [];  // 다중 정렬을 위한 배열

let filterConditions = {
  floor:         { min: null, max: null }, // ⬅️ 추가
  deposit_price: { min: null, max: null },
  premium_price: { min: null, max: null },
  monthly_rent:  { min: null, max: null },
  area_py:       { min: null, max: null },
  sale_price:    { min: null, max: null },
  roi:           { min: null, max: null } // ROI는 소수 단위
};

function sortListings(list) {
  if (!Array.isArray(currentSort) || currentSort.length === 0) return list;

  return list.slice().sort((a, b) => {
    for (const { key, ascending } of currentSort) {
      let valA = a[key];
      let valB = b[key];

      // 숫자는 숫자로 비교
      if (!isNaN(parseFloat(valA)) && !isNaN(parseFloat(valB))) {
        valA = parseFloat(valA);
        valB = parseFloat(valB);
      } else {
        // 문자열은 대소문자 무시
        valA = (valA ?? '').toString().toLowerCase();
        valB = (valB ?? '').toString().toLowerCase();
      }

      if (valA < valB) return ascending ? -1 : 1;
      if (valA > valB) return ascending ? 1 : -1;
      // 같으면 다음 key 정렬 기준으로 넘어감
    }
    return 0;
  });
}

async function fetchMoreListings() {
  if (isLoading || !hasMore) return;
  isLoading = true;

  const { data: listingsData } = await client
    .from('baikukdbtest').select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const { data: buildingsData } = await client
    .from('building_info').select('addr_compare, building_name');

  const buildingMap = new Map(buildingsData.map(b => [b.addr_compare, b.building_name]));
  const enrichedData = listingsData.map(listing => ({
    ...listing,
    building_name: buildingMap.get(listing.addr_compare) || '-'
  }));

  listings = listings.concat(enrichedData);
  if (listingsData.length < limit) hasMore = false;
  offset += listingsData.length;

  document.getElementById('listings-body').innerHTML = '';
  renderListings(sortListings(applyAllFilters(listings), currentSort.key, currentSort.ascending));
  isLoading = false;
}

// 필터 적용함수
function applyAllFilters(dataToFilter) {
  const selectedDealTypes  = getCheckedValues("deal-type-checkbox");
  const selectedStatuses   = getCheckedValues("transaction-status-checkbox");
  const selectedCategories = getCheckedValues("category-checkbox");

  const normalizeStatus = (raw) => {
    const s = (raw || '').trim();
    if (!s) return '-';
    if (s.includes('진행중'))   return '진행중';
    if (s.includes('보류'))     return '보류';
    if (s.includes('계약완료')) return '계약완료';
    return '-';
  };

  return dataToFilter.filter(listing => {
    // 숫자 필터
    const numericMatch = Object.entries(filterConditions).every(([key, { min, max }]) => {
      const value = parseFloat(listing[key]);
      if (Number.isNaN(value)) return true;
      if (min != null && value < min) return false;
      if (max != null && value > max) return false;
      return true;
    });

    // 체크박스 필터
    const matchDealType = selectedDealTypes.length === 0 
      || selectedDealTypes.includes(listing.deal_type);

    const normStatus = normalizeStatus(listing.transaction_status);
    const matchStatus = selectedStatuses.length === 0 
      || selectedStatuses.includes(normStatus);

    const matchCategory = selectedCategories.length === 0 
      || selectedCategories.includes(listing.category || '-');

    return numericMatch && matchDealType && matchStatus && matchCategory;
  });
}

// 카테고리 선택시 휠 없어지면 추가로 매물로딩 관련함수
function checkAndFetchIfNoScroll() {
  const container = document.getElementById('table-container');
  // 스크롤이 생기지 않을 경우 자동으로 fetchMoreListings 호출
  if (container.scrollHeight <= container.clientHeight && hasMore) {
    fetchMoreListings();
  }
}

const headerRow = document.getElementById('header-row');

async function serverSearch(idTerm, titleTerm, addressTerm, buildingTerm) {
  listings = []; offset = 0; hasMore = false;
  let matchedAddresses = [];

  if (buildingTerm) {
    const { data: matchedBuildings } = await client
      .from('building_info')
      .select('addr_compare')
      .ilike('building_name', `%${buildingTerm}%`);
    matchedAddresses = matchedBuildings.map(b => b.addr_compare);
  }

  let query = client.from('baikukdbtest').select('*').limit(1000);
  if (idTerm && !isNaN(parseInt(idTerm))) query = query.eq('listing_id', parseInt(idTerm));
  if (titleTerm) query = query.ilike('listing_title', `%${titleTerm}%`);

  if (addressTerm) {
    const addrTerms = addressTerm.split(',').map(s => s.trim()).filter(Boolean);
    if (addrTerms.length === 1) {
      query = query.ilike('full_address', `%${addrTerms[0]}%`);
    } else if (addrTerms.length > 1) {
      const orExp = addrTerms.map(t => `full_address.ilike.%${t}%`).join(',');
      query = query.or(orExp);
    }
  }

  if (buildingTerm && matchedAddresses.length > 0) {
    query = query.in('addr_compare', matchedAddresses);
  }

  const { data: listingsData } = await query;
  const { data: buildingsData } = await client
    .from('building_info')
    .select('addr_compare, building_name');

  const buildingMap = new Map(buildingsData.map(b => [b.addr_compare, b.building_name]));
  return listingsData.map(listing => ({
    ...listing,
    building_name: buildingMap.get(listing.addr_compare) || '-'
  }));
}

function renderListings(data) {
  const tbody = document.getElementById('listings-body');
  data.forEach(listing => {
    const row = document.createElement('tr');
    row.dataset.listingId = listing.listing_id; // ✅ 클릭용 ID 저장
    row.className = 'border-b border-gray-300 hover:bg-yellow-50 cursor-pointer';

    // 🔁 교차 배경색 (Tailwind 배경색 클래스 적용 → hover 유지됨)
    if (tbody.children.length % 2 === 0) {
      row.classList.add('bg-white');
    } else {
      row.classList.add('bg-gray-50'); // f9fafb
    }

    row.innerHTML = `
      <td class="p-1 text-base font-bold whitespace-normal w-[4rem] ">
        <span>${listing.listing_id}</span>
      </td>
      <td class="flex flex-col p-1 text-base text-right whitespace-nowrap">
        <div style="
          ${(listing.transaction_status || '').includes('진행중') 
            ? 'background-color: #d9fae6; color: #00b74a; font-weight: bold;' 
            : (listing.transaction_status || '').includes('보류') 
              ? 'background-color: #e5e7eb; color: #000000; font-weight: bold;'
              : (listing.transaction_status || '').includes('계약완료') 
                ? 'background-color: rgba(255,237,237); color: rgba(247,63,87); font-weight: 900;' 
                : 'background-color: #e5e7eb; color: #374151;'}
          padding: 2px 8px; 
          border-radius: 8px; 
          display: inline-block;
          font-size: 0.8rem;
          text-align: center;
          margin-top: 0.25rem;
        ">
          ${(listing.transaction_status || '').includes('진행중') 
            ? '진행중' 
            : (listing.transaction_status || '').includes('보류') 
              ? '보류' 
              : (listing.transaction_status || '').includes('계약완료') 
                ? '계약완료' 
                : '-'}
        </div>
        <div style="
          ${listing.is_public 
            ? 'background-color: #ffffff; color: #00b74a; font-weight: bold; border: 1.5px solid #00b74a; border-radius: 9999px;'   /* 공개: 초록 pill */
            : 'background-color: #ffffff; color: rgba(247,63,87); font-weight: 900; border: 1.5px solid rgba(247,63,87); border-radius: 9999px;' /* 비공개: 빨강 pill */
          }
          padding: 2px 12px; 
          display: inline-block;
          font-size: 0.8rem;
          text-align: center;
          margin-top: 0.25rem;
        ">
          ${listing.is_public ? '공개' : '비공개'}
        </div>
      </td>
      <td class="p-1 font-bold text-lg whitespace-normal break-words">
        <span>${listing.listing_title || '-'}</span>
      </td>
      <td class="p-1 text-left text-base w-[10rem]">${listing.province} ${listing.city} ${listing.district} ${listing.detail_address}</td>
      <td class="p-1 text-left text-[1.05rem] w-[12rem] overflow-x-auto whitespace-nowrap">${listing.building_name}</td>
      <td class="p-1 text-base"><div id="scroll-cell-${listing.listing_id}" class="max-w-[6rem] overflow-x-auto whitespace-nowrap">${listing.unit_info || '-'}</div></td>
      <td class="p-1 text-right text-base">${formatNumber(listing.floor)}층</td>
      <td class="p-1 text-right text-lg whitespace-nowrap">${formatNumber(listing.deposit_price)}</td>
      <td class="p-1 text-right text-lg whitespace-nowrap">${formatNumber(listing.monthly_rent)}</td>
      <td class="p-1 text-right text-lg whitespace-nowrap">${formatNumber(listing.premium_price)}</td>
      <td class="p-1 text-right text-lg whitespace-nowrap">${listing.area_py != null ? Number(listing.area_py).toFixed(0) : '-'}평</td>
      <td class="p-1 text-right text-base"><div>${listing.supply_area_m2 != null ? Number(listing.supply_area_m2).toFixed(2) : '-'}㎡</div><div>${listing.area_m2 != null ? Number(listing.area_m2).toFixed(2) : '-'}㎡</div></td>
      <td class="p-1 text-right text-lg">${formatNumber(listing.sale_price)}</td>
      <td class="p-1 text-right text-lg">${formatNumber(listing.total_deposit)}</td>
      <td class="p-1 text-right text-lg">${formatNumber(listing.total_rent)}</td>
      <td class="p-1 text-right text-lg">${listing.roi != null ? (Number(listing.roi) * 100).toFixed(1) + '%' : '-'}</td>
      <td class="p-1">${listing.store_category || '-'}</td>`;
    tbody.appendChild(row);

    requestAnimationFrame(() => {
      const scrollDiv = document.getElementById(`scroll-cell-${listing.listing_id}`);
      if (scrollDiv) scrollDiv.scrollLeft = scrollDiv.scrollWidth;
    });
  });

  // ✅ 렌더링 후, 스크롤 부족 시 자동 로딩
  checkAndFetchIfNoScroll();
}

function setupScrollTrigger() {
  const tableContainer = document.getElementById('table-container');
  tableContainer.addEventListener('scroll', () => {
    const nearBottom = tableContainer.scrollTop + tableContainer.clientHeight >= tableContainer.scrollHeight - 100;
    if (nearBottom) fetchMoreListings();
  });
}

function updateSortIndicators() {
  const keyMap = {
    '매물번호': 'listing_id',
    '상태': null,
    '매물명': 'listing_title',
    '주소': 'full_address',
    '건물정보': 'building_name',
    '호수': null,
    '층': 'floor',
    '보증금': 'deposit_price',
    '월세': 'monthly_rent',
    '권리금': 'premium_price',
    '전용(평)': 'area_py',
    '공급/전용(㎡)': null,
    '매매가': 'sale_price',
    '총보증금': null,
    '총월세': null,
    '수익률': 'roi',
    '상가타입': null
  };

  document.querySelectorAll('thead th').forEach(th => {
    const text = th.innerText.trim().replace(/\s*\(\d+\)\s*[▲▼]?/g, '');
    const key = keyMap[text];

    if (!key) {
      th.innerHTML = text; // 정렬 불가 항목
      return;
    }

    // 현재 key가 currentSort 안에 있는지 확인
    const idx = currentSort.findIndex(s => s.key === key);
    
    if (idx === -1) {
      // 정렬 미적용 — 기본표시
      th.innerHTML = text;
    } else {
      const { ascending } = currentSort[idx];
      const arrow = ascending ? '▲' : '▼';
      const order = idx + 1;
      th.innerHTML = `${text} <span style="color:#1f2937; font-size:0.75rem;">(${order}) ${arrow}</span>`;
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.__BLOCK_APP__) return; // 🔒 로그인 전에는 앱 로직 차단
  fetchMoreListings();
  setupScrollTrigger();
  bindNumericFilterInputs(); 
  updateSortIndicators();

  /* 🔥 정렬만 초기화 (Reset Sort) */
  document.getElementById("reset-filters-btn")?.addEventListener("click", () => {
    console.log("정렬 초기화 실행됨");

    // 1) 정렬 기준 리셋
    currentSort = [];

    // 2) 헤더 아이콘 업데이트
    updateSortIndicators();

    // 3) 필터는 그대로 유지한 채, 정렬만 제거하고 출력
    const filtered = applyAllFilters(listings);
    const sorted = sortListings(filtered);

    document.getElementById("listings-body").innerHTML = "";
    renderListings(sorted);

    console.log("정렬만 초기화 완료");
  });

  // ✅ 필터 UI 초기값 설정
  document.querySelector('input.deal-type-checkbox[value="월세"]').checked = true;
  document.querySelector('input.category-checkbox[value="상가"]').checked = true;

  // 검색 입력 요소들
  const searchButton = document.getElementById('search-button');
  const idInput = document.getElementById('id-input');
  const titleInput = document.getElementById('title-input');
  const addressInput = document.getElementById('address-input');
  const buildingInput = document.getElementById('building-input');

  // ✅ 요소가 모두 있는 경우에만 이벤트 리스너 등록
  if (searchButton && idInput && titleInput && addressInput && buildingInput) {
    searchButton.addEventListener('click', async () => {
      const idTerm = idInput.value.trim();
      const titleTerm = titleInput.value.trim();
      const addressTerm = addressInput.value.trim();
      const buildingTerm = buildingInput.value.trim();

      const enriched = await serverSearch(idTerm, titleTerm, addressTerm, buildingTerm);
      listings = enriched;
      const finalFiltered = applyAllFilters(enriched);

      document.getElementById('listings-body').innerHTML = '';
      renderListings(sortListings(finalFiltered, currentSort.key, currentSort.ascending));
    });

    // ✅ Enter 키 눌렀을 때 검색
    [idInput, titleInput, addressInput, buildingInput].forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchButton.click();
      });
    });
  } else {
    console.error('❌ 검색 입력 필드 중 하나 이상이 DOM에 없습니다.');
  }

  // ✅ 테이블 헤더 열 크기 조절
  const table = document.querySelector('table');
  if (table) {
    const headers = table.querySelectorAll('th');
    headers.forEach(th => {
      th.classList.add('resizable');

      const handle = document.createElement('div');
      handle.classList.add('resize-handle');
      th.appendChild(handle);

      handle.addEventListener('mousedown', function (e) {
        e.preventDefault();
        const startX = e.pageX;
        const startWidth = th.offsetWidth;
        th.classList.add('resizing');

        const onMouseMove = e => {
          th.style.width = `${startWidth + (e.pageX - startX)}px`;
        };

        const onMouseUp = () => {
          th.classList.remove('resizing');
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    });
  }

  // ✅ 행 클릭 → /<매물번호> 로 이동 (Ctrl/⌘-클릭 또는 휠클릭은 새 탭)
  const tbody = document.getElementById('listings-body');

  // function goToListing(id) { 나중에 이동링크 수정
  //   const href = makeAdminUrl({ id: String(id) }); // ✅ '/admin?id=24873'
  //   window.open(href, '_blank', 'noopener,noreferrer');
  // }

  function goToListing(id) {
    const href = `https://baikuk.com/item/view/${id}`;
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  tbody.addEventListener('click', (e) => {
    // 인터랙티브 요소 클릭 시엔 행 네비게이션 막기
    if (e.target.closest('input, button, label, a, select, textarea')) return;

    const tr = e.target.closest('tr[data-listing-id]');
    if (!tr) return;

    goToListing(tr.dataset.listingId);
  });

  // (선택) 중클릭 핸들러가 있다면, 아래처럼 인터랙티브 요소는 무시하도록 보정
  tbody.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    if (e.target.closest('input, button, label, a, select, textarea')) return; // ✅ a에서의 중클릭 중복방지
    const tr = e.target.closest('tr[data-listing-id]');
    if (!tr) return;
    goToListing(tr.dataset.listingId);
  });

  // ✅ 계정정보 표시 + '정산' 탭 권한 제어(관리자/지점장만 노출)
  (async () => {
    try {
      const { data: { user } } = await client.auth.getUser();
      if (!user?.id) return;

      // 1) 계정정보(public_staff_view) & 권한(staff_profiles) 병렬 조회
      const email = user.email || '';
      const [staffRes, authRes] = await Promise.all([
        client.from('public_staff_view')
              .select('name,email,affiliation,position,extension')
              .eq('email', email)
              .maybeSingle(),
        client.from('staff_profiles')
              .select('authority')
              .eq('user_id', user.id)
              .maybeSingle()
      ]);

      // 2) 상단 계정정보 렌더 (조회 실패 시 이메일만 표시)
      const staff = staffRes?.data;
      const hasStaff = !!staff && !staffRes.error;

      const $name        = document.getElementById('account-name');
      const $email       = document.getElementById('account-email');
      const $affiliation = document.getElementById('account-affiliation');
      const $position    = document.getElementById('account-position');
      const $extension   = document.getElementById('account-extension');

      if ($name)        $name.textContent        = hasStaff ? (staff.name || '') : (user.email || '');
      if ($email)       $email.textContent       = hasStaff ? (staff.email || email || '') : (user.email || '');
      if ($affiliation) $affiliation.textContent = hasStaff ? (staff.affiliation || '') : '';
      if ($position)    $position.textContent    = hasStaff ? (staff.position || '') : '';
      if ($extension)   $extension.textContent   = hasStaff ? (staff.extension || '') : '';

      // 3) '정산' 탭 권한 제어
      const authority = (authRes?.data?.authority || '').trim();
      const tab = document.getElementById('settlement-tab');
      if (!tab) return;

      // 직원 클릭 가드
      const guardClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        alert('직원 권한은 정산 메뉴에 접근할 수 없습니다.');
      };

      if (authority === '직원') {
        // 직원: 숨김 + 클릭 가드(혹시 보이더라도 접근 차단)
        tab.style.display = 'none';
        tab.removeEventListener('click', guardClick);
        tab.addEventListener('click', guardClick);
      } else {
        // 관리자/지점장: 노출 + 기존 리스너 초기화(가드 제거)
        tab.style.removeProperty('display');
        const clean = tab.cloneNode(true);
        tab.replaceWith(clean);
      }
    } catch (e) {
      console.warn('계정/권한 조회 중 예외:', e);
      // 실패해도 앱 진행은 막지 않음
    }
  })();

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await client.auth.signOut();
    // 로그아웃 후 로그인 화면(또는 메인 지도)으로 이동
    location.replace('/admin/listings/');
  });

  document.querySelectorAll('thead th').forEach(th => {
    const keyMap = {
      '매물번호': 'listing_id',
      '매물명': 'listing_title',
      '주소': 'full_address',
      '건물정보': 'building_name',
      '층': 'floor',
      '보증금': 'deposit_price',
      '월세': 'monthly_rent',
      '권리금': 'premium_price',
      '전용(평)': 'area_py',
      '매매가': 'sale_price',
      '수익률': 'roi',
    };

    const text = th.innerText.trim();
    const key = keyMap[text];

    if (key) th.classList.add('cursor-pointer');

    th.addEventListener('click', () => {
      if (!key) return;

      const existing = currentSort.find(s => s.key === key);

      if (existing) {
        existing.ascending = !existing.ascending;
      } else {
        currentSort.push({ key, ascending: true });
      }

      const sorted = sortListings(applyAllFilters(listings));
      document.getElementById('listings-body').innerHTML = '';
      renderListings(sorted);

      // 🔥 정렬 상태를 헤더에 표시
      updateSortIndicators();
    });
  });

});

document.getElementById('open-admin-listing-btn')?.addEventListener('click', () => {
  const href = makeAdminUrl({ autoclick: 'open-listing' });
  window.open(href, '_blank', 'noopener,noreferrer');
});

function getCheckedValues(className) {
  return Array.from(document.querySelectorAll(`.${className}:checked`)).map(el => el.value);
}
