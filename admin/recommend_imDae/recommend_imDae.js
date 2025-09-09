// /pages/admin/recommend-imDae/recommend-imDae.js
// 모듈 전역 ----------------------------------------------------
let currentCustomerId = null;

// Supabase 초기화 ---------------------------------------------
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(
  'https://sfinbtiqlfnaaarziixu.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmaW5idGlxbGZuYWFhcnppaXh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI1MDkxNjEsImV4cCI6MjA2ODA4NTE2MX0.4-7vnIjbF-biWWuv9-vTxK9Y99gMm-vS6oaRMdRL5fA'
);

// ✅ 로그인 여부 확인 후 없으면 / 로 이동
(async () => {
  const { data, error } = await supabase.auth.getSession(); // <-- client → supabase 로 수정
  if (!data?.session) {
    console.warn('로그인 세션 없음 → / 로 이동');
    location.replace('/');
  }
})();

window.supabase = supabase; // 필요한 경우 디버깅 접근

// 공용 유틸 ----------------------------------------------------
function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.backgroundColor = '#F2C130';
  toast.style.color = 'black';
  toast.style.fontWeight = 'bold';
  toast.className = 'fixed top-5 left-1/2 transform -translate-x-1/2 px-4 py-2 rounded shadow-lg z-[9999]';
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), duration);
}

function formatKoreanMoney(value) {
  if (!value && value !== 0) return '-';
  const num = Number(value);
  if (isNaN(num)) return '-';
  if (num >= 10000) {
    const eok = Math.floor(num / 10000);
    const man = num % 10000;
    return `${eok}억${man > 0 ? ' ' + man.toLocaleString() : ''}`;
  }
  return num.toLocaleString();
}

// --- data-field 읽기/도움 함수들 ------------------------------
function getFieldValue(field, index) {
  const el = document.querySelector(`[data-field="${field}_${index}"]`);
  if (!el) return '';
  if (el.tagName === 'SPAN') return (el.textContent || '').trim();
  return (el.value || '').trim();
}
function getListingNumber(index) {
  const input = document.querySelector(`input[data-index="${index}"]`);
  return (input?.value || '').trim();
}
const stripEmpty = (s) => (s || '').trim();
function joinMoney(deposit, monthly) {
  const a = (deposit || '').trim();
  const b = (monthly || '').trim();
  const aL = a ? `${a}` : '';
  const bL = b ? `${b}` : '';
  if (a && b) return `${aL}/${bL}`;
  return aL || bL || '';
}
function hasMeaningfulData(index) {
  const keys = [
    'listing_title','full_address','combined_unit','deposit_price',
    'monthly_rent','premium_price','area_py','description'
  ];
  return keys.some(k => !!getFieldValue(k, index));
}

function buildMessageForRow(index) {
  const no     = getListingNumber(index) || '';
  const title  = getFieldValue('listing_title', index) || '-';
  const addr   = getFieldValue('full_address', index) || '-';
  const unit   = getFieldValue('combined_unit', index) || '-';
  const dep    = getFieldValue('deposit_price', index);
  const mon    = getFieldValue('monthly_rent', index);
  const prem   = getFieldValue('premium_price', index);
  const area   = getFieldValue('area_py', index);
  const desc   = getFieldValue('description', index);

  const line1 = `${title}`.trim();
  const line2 = `${addr} ${unit}`.trim();

  const areaPart   = area ? `${area}평` : '';
  const moneyPair  = joinMoney(dep, mon);
  const premiumTag = prem ? `권${prem}` : '';
  const parts = [areaPart, moneyPair, premiumTag].filter(Boolean);
  const line3 = parts.join(' ');

  const line4 = desc || '';
  const baseUrl = "http://localhost:5173/";
  const line5 = no ? `${baseUrl}?id=${no}` : '';

  const lines = [line1, line2, line3, line4, line5].filter(Boolean);
  return lines.join('\n');
}

function buildAllMessages() {
  const rows = document.querySelectorAll('#listings-body tr');
  const blocks = [];
  rows.forEach((_, i) => {
    const idx = i + 1;
    if (hasMeaningfulData(idx) || getListingNumber(idx)) {
      const msg = buildMessageForRow(idx);
      if (msg) blocks.push(`${blocks.length + 1}.\n${msg}`);
    }
  });
  return blocks.join('\n\n');
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('링크용 문구를 복사했어요.');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); showToast('링크용 문구를 복사했어요.'); }
    catch { showToast('복사에 실패했습니다. 수동으로 복사해주세요.'); }
    document.body.removeChild(ta);
  }
}

// 권한/담당 관련 ------------------------------------------------
async function getAuthContext() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { me: null, myAuth: null, myAff: null };

  const { data: me } = await supabase
    .from('staff_profiles')
    .select('id, authority, affiliation')
    .eq('user_id', user.id)
    .maybeSingle();

  return { me, myAuth: me?.authority ?? null, myAff: (me?.affiliation ?? '').trim() };
}

async function loadStaffOptions(currentStaffId = null) {
  const staffSelect = document.getElementById('staff-select');
  if (!staffSelect) return;
  staffSelect.innerHTML = '';

  const { me, myAuth, myAff } = await getAuthContext();
  if (!me) return;

  let q = supabase
    .from('staff_profiles')
    .select('id, name, affiliation, leave_date')
    .order('affiliation', { ascending: true })
    .order('name', { ascending: true });

  if (myAuth === '직원') q = q.is('leave_date', null);

  const { data: staffList } = await q;
  if (!staffList) return;

  const grouped = staffList.reduce((acc, s) => {
    (acc[s.affiliation || '미지정'] ||= []).push(s);
    return acc;
  }, {});

  const appendGroup = (label, members) => {
    if (!members?.length) return;
    const og = document.createElement('optgroup');
    og.label = label;
    members.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      const retiredTag = (myAuth !== '직원' && s.leave_date) ? ' (퇴사)' : '';
      opt.textContent = `${s.name}${retiredTag}`;
      if (currentStaffId && s.id === currentStaffId) opt.selected = true;
      og.appendChild(opt);
    });
    staffSelect.appendChild(og);
  };

  if (myAff && grouped[myAff]) {
    appendGroup(`${myAff} (같은 소속)`, grouped[myAff]);
    delete grouped[myAff];
  }
  Object.entries(grouped).forEach(([aff, members]) => appendGroup(aff, members));
}

async function loadCurrentUserStaffInfo() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return;
  const { data: staff } = await supabase
    .from('staff_profiles')
    .select('position, name, phone_num')
    .eq('user_id', user.id)
    .maybeSingle();
  if (staff) {
    const staffInfoBox = document.getElementById('staff-info');
    staffInfoBox.textContent = `${staff.position} ${staff.name} ${staff.phone_num}`;
    staffInfoBox.classList.remove('hidden');
    document.getElementById('staff-select').classList.add('hidden');
  }
}

async function getMyStaffId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: me } = await supabase
    .from('staff_profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();
  return me?.id ?? null;
}

async function isMyAssignedCustomer(customerId) {
  const myId = await getMyStaffId();
  if (!myId || !customerId) return false;

  const [{ data: link }, { data: cust }] = await Promise.all([
    supabase
      .from('customer_assignees')
      .select('customer_id')
      .eq('customer_id', customerId)
      .eq('staff_profiles_id', myId)
      .maybeSingle(),
    supabase
      .from('customers')
      .select('id, staff_profiles_id')
      .eq('id', customerId)
      .maybeSingle()
  ]);
  return !!link || (!!cust && cust.staff_profiles_id === myId);
}

// 고객/추천 로딩 ------------------------------------------------
async function loadCustomerDataByName(name) {
  const myId = await getMyStaffId();
  if (!myId) { showToast('로그인 필요'); return; }

  const { data: customer, error: custError } = await supabase
    .from('customers')
    .select('id, customer_name, customer_phone_number, grade, memo, staff_profiles_id')
    .eq('customer_name', name)
    .maybeSingle();

  if (custError || !customer) { showToast('고객 정보를 찾을 수 없습니다.'); return; }

  const allowed = (customer.staff_profiles_id === myId) || (await isMyAssignedCustomer(customer.id));
  if (!allowed) { showToast('담당자가 아닌 고객은 볼 수 없습니다.'); return; }

  currentCustomerId = customer.id;

  document.getElementById('top-row-input').value     = customer.customer_name || '';
  document.getElementById('customer-phone').value    = customer.customer_phone_number || '';
  document.getElementById('customer-grade').value    = customer.grade || 'F';
  document.getElementById('memo-textarea').value     = customer.memo || '';
  document.querySelectorAll('input[data-index]').forEach(input => input.value = '');
  document.getElementById('listings-body').innerHTML = '';

  const { data: listings, error: listingsError } = await supabase
    .from('customers_recommendations')
    .select('*')
    .eq('customers_id', currentCustomerId);

  if (listingsError) { showToast('추천 매물 정보를 불러오지 못했습니다.'); return; }

  listings.forEach((listing, i) => {
    const index = i + 1;
    const leftInput = document.querySelector(`input[data-index="${index}"]`);
    if (leftInput) leftInput.value = listing.listing_id;

    updateListingsTableByInputs();
    const setField = (field, value) => {
      const el = document.querySelector(`[data-field="${field}_${index}"]`);
      if (el) el.value = value ?? '';
    };
    setField('listing_title', listing.listing_title);
    setField('full_address', listing.full_address);
    setField('combined_unit', listing.building_detail_info);
    setField('deposit_price', listing.deposit_price);
    setField('monthly_rent', listing.monthly_rent);
    setField('premium_price', listing.premium_price);
    setField('area_py', listing.area_py);
    setField('description', listing.contents);
  });

  syncRowHeights?.();
  applyRowStriping?.();
  showToast(`고객 "${name}" 데이터 불러옴`);

  if (isEditMode) { toggleButton.click(); switchInputsToSpans(); }
  switchInputsToSpans();

  const staffInfoBox = document.getElementById('staff-info');
  if (customer.staff_profiles_id) {
    const { data: staff } = await supabase
      .from('staff_profiles')
      .select('position, name, phone_num')
      .eq('id', customer.staff_profiles_id)
      .maybeSingle();
    if (staff && staffInfoBox) {
      staffInfoBox.textContent = `${staff.position} ${staff.name} ${staff.phone_num}`;
      staffInfoBox.classList.remove('hidden');
      document.getElementById('staff-select').classList.add('hidden');
    }
  }
}

async function loadCustomersForCurrentStaff() {
  const myId = await getMyStaffId();
  if (!myId) return;

  const { data: primaryList } = await supabase
    .from('customers')
    .select('id, customer_name, grade')
    .eq('staff_profiles_id', myId);

  const { data: assigneeList } = await supabase
    .from('customers')
    .select(`
      id,
      customer_name,
      grade,
      customer_assignees!inner(staff_profiles_id, is_primary)
    `)
    .eq('customer_assignees.staff_profiles_id', myId);

  const map = new Map();
  (primaryList || []).forEach(c => map.set(c.id, { ...c, role: '대표' }));
  (assigneeList || []).forEach(c => {
    const prev = map.get(c.id);
    const role = (c.customer_assignees?.[0]?.is_primary || prev?.role === '대표') ? '대표' : '보조';
    map.set(c.id, { id: c.id, customer_name: c.customer_name, grade: c.grade, role });
  });

  let customers = Array.from(map.values());
  const gradeOrder = { A:0, B:1, C:2, F:3 };
  customers.sort((a,b) => {
    const ga = gradeOrder[a.grade] ?? 99;
    const gb = gradeOrder[b.grade] ?? 99;
    if (ga !== gb) return ga - gb;
    return (a.customer_name || '').localeCompare(b.customer_name || '', 'ko');
  });

  const custIds = customers.map(c => c.id);
  const { data: assigneesAll, error: assAllErr } = await supabase
    .from('customer_assignees')
    .select('customer_id, staff_profiles!inner(id, name)')
    .in('customer_id', custIds);

  const otherNameMap = new Map();
  if (!assAllErr && assigneesAll) {
    const byCustomer = new Map();
    assigneesAll.forEach(row => {
      const sp = row.staff_profiles;
      if (!sp) return;
      if (!byCustomer.has(row.customer_id)) byCustomer.set(row.customer_id, new Map());
      byCustomer.get(row.customer_id).set(sp.id, sp.name);
    });
    const myId2 = await getMyStaffId();
    byCustomer.forEach((idNameMap, cid) => {
      if (idNameMap.size === 2 && idNameMap.has(myId2)) {
        for (const [sid, sname] of idNameMap.entries()) {
          if (sid !== myId2) { otherNameMap.set(cid, sname); break; }
        }
      }
    });
  }

  const container = document.getElementById('customer-list');
  if (!container) return;
  container.innerHTML = '';

  const filteredCustomers = customers.filter(c => ['A','B','C'].includes((c.grade || '').toUpperCase()));
  const grouped = filteredCustomers.reduce((acc, c) => {
    (acc[(c.grade || '미분류').toUpperCase()] ||= []).push(c);
    return acc;
  }, {});
  const gradeOrderList = ['A','B','C','F'];
  const sortedGrades = [
    ...gradeOrderList.filter(g => grouped[g]?.length),
    ...Object.keys(grouped).filter(g => !gradeOrderList.includes(g))
  ];

  sortedGrades.forEach(grade => {
    const list = grouped[grade] || [];
    if (!list.length) return;

    const header = document.createElement('div');
    header.className = 'grade-header';
    header.textContent = grade;
    container.appendChild(header);

    list.sort((a,b) => (a.customer_name || '').localeCompare(b.customer_name || '', 'ko'))
      .forEach(cust => {
        const nameBtn = document.createElement('div');
        nameBtn.className = 'name-item';

        const other = otherNameMap.get(cust.id);
        const sub = document.createElement('span');
        sub.className = 'mr-1 text-sm text-gray-500';
        sub.textContent = other ? `(${other})` : '';

        const label = document.createElement('span');
        label.textContent = cust.customer_name || '-';

        nameBtn.append(sub, label);
        nameBtn.setAttribute('role','button');
        nameBtn.tabIndex = 0;
        nameBtn.addEventListener('click', () => loadCustomerDataByName(cust.customer_name));
        nameBtn.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loadCustomerDataByName(cust.customer_name); }
        });

        container.appendChild(nameBtn);
      });
  });
}

// 편집/표 렌더링 -----------------------------------------------
function switchSpansToInputs() {
  document.querySelectorAll('#listings-body tr').forEach(row => {
    row.querySelectorAll('span[data-field]').forEach(span => {
      const field = span.dataset.field;
      const value = span.textContent || '';
      let inputEl;
      if (field.startsWith('listing_title_') || field.startsWith('full_address_') || field.startsWith('description_')) {
        inputEl = document.createElement('textarea');
        inputEl.rows = 2;
        inputEl.className = 'w-full text-center text-base border rounded bg-white outline-none resize-none';
      } else {
        inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.className = 'w-full text-center text-base border rounded bg-white outline-none';
      }
      inputEl.value = value;
      inputEl.dataset.field = field;
      span.parentElement.replaceChild(inputEl, span);
    });
  });
}

function switchInputsToSpans() {
  document.querySelectorAll('#listings-body tr').forEach(row => {
    row.querySelectorAll('input[data-field], textarea[data-field]').forEach(el => {
      const span = document.createElement('span');
      span.className = 'text-base block whitespace-pre-wrap';
      span.dataset.field = el.dataset.field;
      span.textContent = el.value || '';
      el.parentElement.replaceChild(span, el);
    });
  });
}

let buildingMap = new Map();

async function preloadBuildingInfo() {
  const { data: buildings, error } = await supabase
    .from('building_info')
    .select('addr_compare, building_name');
  if (!error && buildings) {
    buildingMap = new Map(buildings.map(b => [b.addr_compare, b.building_name]));
  }
}

function updateListingsTableByInputs() {
  const listingsBody = document.getElementById('listings-body');
  const allInputs = document.querySelectorAll('input[data-index]');
  let maxIndex = 0;
  allInputs.forEach(input => {
    const val = input.value.trim();
    const idx = parseInt(input.dataset.index);
    if (val !== '' && !isNaN(idx)) maxIndex = Math.max(maxIndex, idx);
  });

  const currentRows = listingsBody.children.length;
  for (let i = currentRows + 1; i <= maxIndex; i++) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="p-1 border text-center">${i}</td>
      <td class="p-1 border text-center">
        <textarea rows="2" class="w-full box-border text-center text-base border rounded bg-white outline-none resize-none" data-field="listing_title_${i}"></textarea>
      </td>
      <td class="p-1 border text-center">
        <textarea rows="2" class="w-full box-border text-center text-base border rounded bg-white outline-none resize-none" data-field="full_address_${i}"></textarea>
      </td>
      <td class="p-1 border text-center">
        <input type="text" class="w-full box-border text-center text-base border rounded bg-white outline-none" data-field="combined_unit_${i}" />
      </td>
      <td class="p-1 border text-center">
        <input type="text" class="w-full box-border text-center text-base border rounded bg-white outline-none" data-field="deposit_price_${i}" />
      </td>
      <td class="p-1 border text-center">
        <input type="text" class="w-full box-border text-center text-base border rounded bg-white outline-none" data-field="monthly_rent_${i}" />
      </td>
      <td class="p-1 border text-center">
        <input type="text" class="w-full box-border text-center text-base border rounded bg-white outline-none" data-field="premium_price_${i}" />
      </td>
      <td class="p-1 border text-center">
        <input type="text" class="w-full box-border text-center text-base border rounded bg-white outline-none" data-field="area_py_${i}" />
      </td>
      <td class="p-1 border text-center">
        <textarea rows="2" class="w-full box-border text-left text-base border rounded bg-white outline-none resize-none" data-field="description_${i}"></textarea>
      </td>
    `;
    listingsBody.appendChild(row);
    applyRowStriping();
  }
  while (listingsBody.children.length > maxIndex) {
    listingsBody.removeChild(listingsBody.lastChild);
  }
}

function applyRowStriping() {
  const rows = document.querySelectorAll('#listings-body tr');
  rows.forEach((row, index) => {
    row.classList.remove('bg-white','bg-gray-50');
    row.classList.add(index % 2 === 0 ? 'bg-white' : 'bg-gray-50');
  });
}

function clearListingRow(index) {
  ['listing_title','full_address','combined_unit','deposit_price','monthly_rent','premium_price','area_py','description']
  .forEach(field => {
    const el = document.querySelector(`[data-field="${field}_${index}"]`);
    if (el) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = '';
      else el.textContent = '';
    }
  });
  syncRowHeights?.();
}

function combineUnitInfo(buildingName, floor, unitInfo) {
  const parts = [];
  if (buildingName && buildingName !== '-') parts.push(buildingName);
  if (floor && floor !== '-') {
    const floorStr = String(floor);
    parts.push(floorStr.endsWith('층') ? floorStr : floorStr + '층');
  }
  if (unitInfo && unitInfo !== '-') {
    const unitStr = String(unitInfo).trim();
    const displayUnit = (unitStr.endsWith('호') || unitStr.endsWith('일부') || unitStr.includes('전체')) ? unitStr : unitStr + '호';
    parts.push(displayUnit);
  }
  return parts.join(' ');
}

async function fetchListingInfo(listingId, rowIndex) {
  const cleanedId = listingId.replace(/[^\d]/g, '');
  if (!cleanedId) return;
  const numericId = Number(cleanedId.replaceAll(',', ''));
  if (isNaN(numericId)) { alert('유효한 숫자 매물번호를 입력해주세요.'); return; }

  const { data: listing, error: listingError } = await supabase
    .from('baikukdbtest')
    .select('listing_title, full_address, addr_compare, unit_info, floor, deposit_price, monthly_rent, premium_price, area_py')
    .eq('listing_id', numericId)
    .single();

  if (listingError || !listing) { showToast(`매물번호 ${listingId} 를 찾을 수 없습니다.`); return; }

  const buildingName = buildingMap.get(listing.addr_compare) ?? '-';
  const combinedUnit = combineUnitInfo(buildingName, listing.floor, listing.unit_info);
  const dataToDisplay = {
    listing_title: listing.listing_title,
    full_address: listing.full_address,
    combined_unit: combinedUnit,
    deposit_price: listing.deposit_price,
    monthly_rent: listing.monthly_rent,
    premium_price: listing.premium_price,
    area_py: listing.area_py
  };

  updateListingsTableByInputs();

  if (!isEditMode) {
    const row = document.querySelectorAll('#listings-body tr')[rowIndex - 1];
    if (row) {
      row.querySelectorAll('input[data-field], textarea[data-field]').forEach(el => {
        const span = document.createElement('span');
        span.className = 'text-base block whitespace-pre-wrap';
        span.dataset.field = el.dataset.field;
        span.textContent = el.value || '';
        el.parentElement.replaceChild(span, el);
      });
    }
  }

  Object.entries(dataToDisplay).forEach(([field, value]) => {
    const el = document.querySelector(`[data-field="${field}_${rowIndex}"]`);
    if (!el) return;
    const formattedValue =
      ['deposit_price','monthly_rent','premium_price'].includes(field) ? formatKoreanMoney(value)
      : field === 'area_py' ? (isNaN(Number(value)) ? '-' : Number(value).toFixed(1))
      : field === 'full_address' ? (typeof value === 'string' ? value.split(' ').slice(1).join(' ') : '-')
      : (value ?? '-');

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = formattedValue;
    else el.textContent = formattedValue;
  });

  syncRowHeights();
  applyRowStriping();
}

// 날짜/담당자 표시 ----------------------------------------------
function displayTodayDate() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const el = document.getElementById('today-date');
  if (el) el.textContent = `${yyyy}-${mm}-${dd}`;
}

async function displayStaffInfo() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return;
  const { data: staff } = await supabase
    .from('staff_profiles')
    .select('position, name, phone_num')
    .eq('user_id', user.id)
    .maybeSingle();
  if (staff) {
    const el = document.getElementById('staff-info');
    if (el) el.textContent = `${staff.position} ${staff.name} ${staff.phone_num}`;
  }
}

// 초기 좌측 입력 1~50칸 생성 -----------------------------------
function buildLeftInputs() {
  const leftTbody = document.getElementById('left-tbody');
  for (let i = 1; i <= 50; i++) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="border-b text-right pr-2">
        <input type="text" placeholder="입력 ${i}" class="w-[5rem] border px-2 rounded text-base ml-auto block" data-index="${i}" />
      </td>
    `;
    leftTbody.appendChild(row);
  }
}

// 행 높이 동기화 ------------------------------------------------
function syncRowHeights() {
  const rightRows = document.querySelectorAll('#listings-body tr');
  const leftRows  = document.querySelectorAll('#left-tbody tr');
  for (let i = 0; i < leftRows.length; i++) {
    const rightRow = rightRows[i];
    const leftRow  = leftRows[i];
    if (rightRow && leftRow) leftRow.style.height = `${rightRow.offsetHeight}px`;
  }
}

// 편집 토글/저장 ------------------------------------------------
const toggleButton = document.getElementById('toggle-edit-btn');
let isEditMode = false;

async function handleToggleEdit() {
  isEditMode = !isEditMode;
  toggleButton.textContent = isEditMode ? '저장' : '수정';
  toggleButton.classList.remove('bg-neutral-500','hover:bg-neutral-600','bg-blue-500','hover:bg-blue-600');
  toggleButton.classList.add(isEditMode ? 'bg-blue-500' : 'bg-neutral-500', isEditMode ? 'hover:bg-blue-600' : 'hover:bg-neutral-600');

  if (isEditMode) {
    switchSpansToInputs();
    showToast('편집 모드로 전환되었습니다.');
    document.getElementById('staff-info').classList.add('hidden');
    document.getElementById('staff-select').classList.remove('hidden');

    const { data: customer } = await supabase
      .from('customers')
      .select('staff_profiles_id')
      .eq('id', currentCustomerId)
      .maybeSingle();
    await loadStaffOptions(customer?.staff_profiles_id);

    const listingsBody = document.getElementById('listings-body');
    const rows = listingsBody.querySelectorAll('tr');
    let lastFilledRowIndex = -1;
    rows.forEach((row, i) => {
      const index = i + 1;
      const keyFields = [
        `listing_title_${index}`, `full_address_${index}`, `deposit_price_${index}`,
        `monthly_rent_${index}`, `area_py_${index}`
      ];
      const hasValue = keyFields.some(field => {
        const el = row.querySelector(`[data-field="${field}"]`);
        if (!el) return false;
        const val = el.tagName === 'SPAN' ? el.textContent : el.value;
        return val && val.trim() !== '';
      });
      if (hasValue) lastFilledRowIndex = i;
    });
    for (let i = rows.length - 1; i > lastFilledRowIndex; i--) listingsBody.removeChild(rows[i]);
    syncRowHeights?.();
    return;
  } else {
    switchInputsToSpans();

    const selectedStaffId = document.getElementById('staff-select').value;
    if (selectedStaffId) {
      await supabase.from('customers').update({ staff_profiles_id: selectedStaffId }).eq('id', currentCustomerId);
      const { data: selectedStaff } = await supabase
        .from('staff_profiles')
        .select('position, name, phone_num')
        .eq('id', selectedStaffId)
        .maybeSingle();
      if (selectedStaff) {
        document.getElementById('staff-info').textContent =
          `${selectedStaff.position} ${selectedStaff.name} ${selectedStaff.phone_num}`;
      }
    }
    document.getElementById('staff-select').classList.add('hidden');
    document.getElementById('staff-info').classList.remove('hidden');

    showToast('읽기 모드로 전환되었습니다.');
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) { showToast('로그인 정보가 필요합니다.'); return; }

  const customerName  = document.getElementById('top-row-input')?.value.trim();
  const customerPhone = document.getElementById('customer-phone')?.value.trim();
  const customerGrade = document.getElementById('customer-grade')?.value;
  const memoText      = document.getElementById('memo-textarea')?.value.trim();

  if (!currentCustomerId) { showToast('먼저 고객을 선택해주세요.'); return; }
  if (!(await isMyAssignedCustomer(currentCustomerId))) { showToast('담당자가 아닌 고객은 수정할 수 없습니다.'); return; }

  if (customerName) {
    const { data: duplicateCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('customer_name', customerName)
      .neq('id', currentCustomerId)
      .maybeSingle();
    if (duplicateCustomer) { showToast(`이미 "${customerName}" 고객이 존재합니다.`); return; }
  }

  const customerData = {
    customer_name: customerName || null,
    customer_phone_number: customerPhone || null,
    phone_last4: customerPhone ? customerPhone.replace(/\D/g,'').slice(-4) : null,
    grade: customerGrade || 'F',
    memo: memoText || null
  };

  const { error: updateError } = await supabase
    .from('customers')
    .update(customerData)
    .eq('id', currentCustomerId);
  if (updateError) { showToast('저장 중 오류 발생'); return; }

  const allIdxInputs = document.querySelectorAll('input[data-index]');
  const listingIds = [];
  allIdxInputs.forEach(input => {
    const raw = input.value.trim();
    const num = Number(raw.replace(/[^\d]/g, ''));
    if (!isNaN(num)) listingIds.push(num);
  });

  if (listingIds.length > 0) {
    const insertData = [];
    listingIds.forEach((listingId, i) => {
      const index = i + 1;
      const getField = (field) => {
        const el = document.querySelector(`[data-field="${field}_${index}"]`);
        if (!el) return '';
        return el.tagName === 'SPAN' ? el.textContent.trim() : el.value.trim();
      };
      const getNum = (field) => {
        const val = getField(field).replace(/,/g, '');
        const num = Number(val);
        return isNaN(num) ? null : num;
      };
      const hasListingId = !!listingId;
      const hasMeaningful = [
        getField('listing_title'), getField('full_address'), getField('combined_unit'),
        getField('description'), getNum('deposit_price'), getNum('monthly_rent'), getNum('area_py')
      ].some(v => v && v !== '-' && v !== '');

      if (hasListingId || hasMeaningful) {
        insertData.push({
          customers_id: currentCustomerId,
          listing_id: listingId,
          listing_title: getField('listing_title'),
          full_address: getField('full_address'),
          building_detail_info: getField('combined_unit'),
          deposit_price: getNum('deposit_price'),
          monthly_rent: getNum('monthly_rent'),
          premium_price: getNum('premium_price'),
          area_py: getNum('area_py'),
          contents: getField('description')
        });
      }
    });

    const seen = new Set();
    const uniqueData = insertData.filter(it => (seen.has(it.listing_id) ? false : seen.add(it.listing_id)));
    const { error: recError } = await supabase
      .from('customers_recommendations')
      .upsert(uniqueData, { onConflict: ['customers_id','listing_id'], returning: 'minimal' });

    if (recError) showToast('추천 매물 저장 중 오류 발생');
    else showToast('추천 매물 저장 완료');
  }

  loadCustomersForCurrentStaff();

  if (isEditMode) toggleButton.click();
}

// 초기화/이벤트 바인딩 ------------------------------------------
function bindLeftInputHandlers() {
  document.querySelectorAll('input[data-index]').forEach(input => {
    const index = parseInt(input.dataset.index);
    input.addEventListener('change', (e) => {
      const value = e.target.value.trim();
      if (value === '') clearListingRow(index);
      else fetchListingInfo(value, index);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const value = e.target.value.trim();
        if (value === '') clearListingRow(index);
        else fetchListingInfo(value, index);
        const nextInput = document.querySelector(`input[data-index="${index + 1}"]`);
        if (nextInput) nextInput.focus();
        e.preventDefault();
      }
    });
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteText = (e.clipboardData || window.clipboardData).getData('text');
      const values = pasteText.split(/[\s,\n]+/).map(str => str.trim()).filter(Boolean);
      values.forEach((val, offset) => {
        const target = document.querySelector(`input[data-index="${index + offset}"]`);
        if (target) { target.value = val; target.dispatchEvent(new Event('change')); }
      });
    });
  });
}

function bindResizeHandles() {
  let startX, startWidth, resizableTh;
  document.querySelectorAll('.resize-handle').forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      resizableTh = e.target.closest('th');
      startX = e.clientX;
      startWidth = resizableTh.offsetWidth;
      document.addEventListener('mousemove', resizeColumn);
      document.addEventListener('mouseup', stopResize);
    });
  });
  function resizeColumn(e) {
    if (!resizableTh) return;
    const newWidth = startWidth + (e.clientX - startX);
    resizableTh.style.width = newWidth + 'px';
  }
  function stopResize() {
    document.removeEventListener('mousemove', resizeColumn);
    document.removeEventListener('mouseup', stopResize);
    resizableTh = null;
  }
}

function buildPrintPortal() {
  wasEditModeForPrint = isEditMode;
  if (isEditMode) switchInputsToSpans();
  portalEl?.remove();
  const src = document.getElementById('print-block');
  if (!src) return;
  portalEl = document.createElement('div');
  portalEl.id = 'print-portal';
  portalEl.style.margin = '0';
  portalEl.style.padding = '0';
  portalEl.appendChild(src.cloneNode(true));
  document.body.appendChild(portalEl);
}
function cleanupPrintPortal() {
  portalEl?.remove();
  portalEl = null;
  if (wasEditModeForPrint) switchSpansToInputs();
  applyRowStriping?.();
  syncRowHeights?.();
}
let wasEditModeForPrint = false;
let portalEl = null;

// 오늘/담당 표시 & 기타 ----------------------------------------
async function initTopInfo() {
  displayTodayDate();
  await displayStaffInfo();
  await loadCurrentUserStaffInfo();
}

// 신규고객 저장 ------------------------------------------------
async function handleSaveNewCustomer() {
  const staffId = await getMyStaffId();
  if (!staffId) { showToast('직원 정보가 없습니다.'); return; }

  const customerName  = document.getElementById('top-row-input')?.value.trim();
  const customerPhone = document.getElementById('customer-phone')?.value.trim();
  const customerGrade = document.getElementById('customer-grade')?.value;
  const memoText      = document.getElementById('memo-textarea')?.value.trim();

  if (!customerName) { showToast('고객 이름은 필수입니다.'); return; }

  const { data: existingCustomer, error: dupCheckError } = await supabase
    .from('customers')
    .select('id')
    .eq('customer_name', customerName)
    .maybeSingle();
  if (dupCheckError) { showToast('중복 검사 중 오류 발생'); return; }
  if (existingCustomer) { showToast(`이미 "${customerName}" 고객이 존재합니다.`); return; }

  const today = new Date().toISOString().split('T')[0];
  const newCustomer = {
    customer_name: customerName,
    customer_phone_number: customerPhone,
    phone_last4: customerPhone?.replace(/\D/g,'').slice(-4) || null,
    grade: customerGrade,
    memo: memoText,
    registered_at: today,
    staff_profiles_id: staffId
  };

  const { data: insertedCustomer, error: insertError } = await supabase
    .from('customers')
    .insert([newCustomer])
    .select();
  if (insertError || !insertedCustomer?.length) { showToast('고객 저장 실패'); return; }

  const customerId = insertedCustomer[0].id;
  showToast(`"${customerName}" 고객 저장 완료`);

  const allInputs = document.querySelectorAll('input[data-index]');
  const listingIds = [];
  allInputs.forEach(input => {
    const raw = input.value.trim();
    const num = Number(raw.replace(/[^\d]/g, ''));
    if (!isNaN(num)) listingIds.push(num);
  });

  if (listingIds.length > 0) {
    const insertData = [];
    listingIds.forEach((listingId, i) => {
      const index = i + 1;
      const getField = (field) => {
        const el = document.querySelector(`[data-field="${field}_${index}"]`);
        if (!el) return '';
        return el.tagName === 'SPAN' ? el.textContent.trim() : el.value.trim();
      };
      const getNum = (field) => {
        const val = getField(field).replace(/,/g, '');
        const num = Number(val);
        return isNaN(num) ? null : num;
      };
      const hasListingId = !!listingId;
      const hasMeaningful = [
        getField('listing_title'), getField('full_address'), getField('combined_unit'),
        getField('description'), getNum('deposit_price'), getNum('monthly_rent'), getNum('area_py')
      ].some(v => v && v !== '-' && v !== '');
      if (hasListingId || hasMeaningful) {
        insertData.push({
          customers_id: customerId,
          listing_id: listingId,
          listing_title: getField('listing_title'),
          full_address: getField('full_address'),
          building_detail_info: getField('combined_unit'),
          deposit_price: getNum('deposit_price'),
          monthly_rent: getNum('monthly_rent'),
          premium_price: getNum('premium_price'),
          area_py: getNum('area_py'),
          contents: getField('description')
        });
      }
    });

    const { error: recError } = await supabase
      .from('customers_recommendations')
      .upsert(insertData, { onConflict: ['customers_id','listing_id'], returning: 'minimal' });
    if (recError) showToast('추천 매물 저장 중 오류 발생');
    else showToast('추천 매물 저장 완료');
  }

  loadCustomersForCurrentStaff();
}

// 초기 실행 ----------------------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
  displayTodayDate();
  await displayStaffInfo();
  await preloadBuildingInfo();
  await loadCustomersForCurrentStaff();
  await loadCurrentUserStaffInfo();

  buildLeftInputs();
  bindLeftInputHandlers();

  const listingsBody = document.getElementById('listings-body');
  const resizeObserver = new ResizeObserver(() => syncRowHeights());
  resizeObserver.observe(listingsBody);

  bindResizeHandles();

  document.addEventListener('focusin', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') e.target.select();
  });

  // 읽기 모드 초기화
  toggleButton.textContent = '수정';
  toggleButton.classList.remove('bg-blue-400','hover:bg-blue-500');
  toggleButton.classList.add('bg-neutral-500','hover:bg-neutral-600');

  // 혹시 입력 필드가 있을 수 있으니 강제로 span 전환
  switchInputsToSpans();

  // 버튼들
  document.getElementById('copy-link-btn')?.addEventListener('click', () => {
    const text = buildAllMessages();
    if (!text) { showToast('복사할 내용이 없습니다.'); return; }
    copyToClipboard(text);
  });
  document.getElementById('print-btn')?.addEventListener('click', () => {
    buildPrintPortal();
    window.print();
    setTimeout(cleanupPrintPortal, 0);
  });
  window.addEventListener('beforeprint', buildPrintPortal);
  window.addEventListener('afterprint', cleanupPrintPortal);

  document.getElementById('save-new-customer')?.addEventListener('click', handleSaveNewCustomer);
  toggleButton?.addEventListener('click', handleToggleEdit);

  window.addEventListener('resize', syncRowHeights);
});
