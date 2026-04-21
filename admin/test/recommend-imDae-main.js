// === 행 관찰용 전역 ===
let listingsBody;          // tbody 캐시
let rowObserver;           // ResizeObserver 인스턴스
// 직원 선택 저장용 전역 변수
let selectedStaffId = null;

// ⭐ 동일 customer_name 모든 리스트 정보 업데이트
async function updateAllSameNameCustomers() {
  const name = document.getElementById("top-row-input").value.trim();
  const grade = document.getElementById("customer-grade").value.trim();
  const phone = document.getElementById("customer-phone").value.trim();
  const memo = document.getElementById("memo-textarea").value.trim();

  if (!name) return;

  try {
    const { error } = await supabase
      .from("customers")
      .update({
        grade: grade,
        customer_phone_number: phone,
        memo: memo
      })
      .eq("customer_name", name);

    if (error) {
      console.error(error);
      showToast("고객 정보 업데이트 중 오류가 발생했습니다.");
    }
  } catch (e) {
    console.error(e);
    showToast("고객 정보 업데이트 중 예외가 발생했습니다.");
  }
}

/* ----------------------------------------------------
  [매물 저장 기능]
  현재 선택된 고객(currentCustomerId)의 매물정보를
  Supabase 테이블 customers_recommendations 에 저장
---------------------------------------------------- */
async function saveListingsForCurrentCustomer() {
  if (!currentCustomerId) {
    showToast("먼저 고객을 선택해주세요.");
    return false;
  }

  // 권한 확인(대표/보조만 가능)
  if (!(await isMyAssignedCustomer(currentCustomerId))) {
    showToast("담당자가 아닌 고객의 매물은 저장할 수 없습니다.");
    return false;
  }

  const rows = document.querySelectorAll("#listings-body tr");
  const result = [];

  rows.forEach((tr, i) => {
    const index = i + 1;

    const listing_title = getFieldValue("listing_title", index);
    const full_address = getFieldValue("full_address", index);
    const deposit_price = getFieldValue("deposit_price", index);
    const monthly_rent = getFieldValue("monthly_rent", index);
    const premium_price = getFieldValue("premium_price", index);
    const area_py = getFieldValue("area_py", index);
    const contents = getFieldValue("description", index);
    const listing_id = getListingNumber(index);
    const color = getFieldValue("color", index);

    // 완전히 비어 있으면 스킵
    if (
      !listing_title &&
      !full_address &&
      !deposit_price &&
      !monthly_rent &&
      !premium_price &&
      !area_py &&
      !contents &&
      !listing_id
    ) return;

    result.push({
      customers_id: String(currentCustomerId),
      order: index,
      listing_id: listing_id || null,
      listing_title: listing_title || null,
      full_address: full_address || null,
      deposit_price: Number(String(deposit_price).replace(/[^\d]/g, "")) || 0,
      monthly_rent: Number(String(monthly_rent).replace(/[^\d]/g, "")) || 0,
      premium_price: Number(String(premium_price).replace(/[^\d]/g, "")) || 0,
      area_py: Number(area_py) || null,
      contents: contents || null,
      memo: getMemoValue(index) || null,
      color: color || null,
      row_properties: {
        strike: getFieldValue("strike", index) === "1" ? 1 : null
      }
    });
  });

  try {
    // 기존 데이터 삭제
    const { error: delErr } = await supabase
      .from("customers_recommendations")
      .delete()
      .eq("customers_id", String(currentCustomerId));

    if (delErr) {
      console.error(delErr);
      showToast("기존 매물 삭제 중 오류.");
      return false;
    }

    // 신규 데이터 삽입
    const { error: insertErr } = await supabase
      .from("customers_recommendations")
      .insert(result);

    if (insertErr) {
      console.error(insertErr);
      showToast("매물 저장 중 오류가 발생했습니다.");
      return false;
    }

    // ⭐ 고객이름 전체에 구분/전화/메모 동기화
    await updateAllSameNameCustomers();

    return true;
  } catch (e) {
    console.error(e);
    showToast("매물 저장 중 예외 발생");
    return false;
  }
}

// === [ADD] '업데이트(매물장)' 표기 유틸 ===
// ISO 또는 Date → "YYYY. M. D. HH:mm" (KST)
function formatDate(input) {
  const d = (input instanceof Date) ? input : new Date(input);
  if (isNaN(d)) return '';
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
  const y = get('year');
  const m = Number(get('month'));
  const day = Number(get('day'));
  const hh = get('hour').padStart(2, '0');
  const mm = get('minute').padStart(2, '0');
  return `${y}. ${m}. ${day}. ${hh}:${mm}`;
}

// timetz 문자열을 KST 오늘 날짜와 결합해 Date로 변환 (오전/오후, +09 지원)
function _timetzToTodayISO(tzStr) {
  if (!tzStr) return null;
  let raw = String(tzStr).trim();

  const ampm = raw.match(/^(오전|오후)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (ampm) {
    const isPM = ampm[1] === '오후';
    let hh = parseInt(ampm[2], 10);
    const mm = ampm[3];
    const ss = ampm[4] || '00';
    if (isPM && hh < 12) hh += 12;
    if (!isPM && hh === 12) hh = 0;
    raw = `${String(hh).padStart(2, '0')}:${mm}:${ss}`;
  }

  const datePart = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  const m = raw.match(/^(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*([+-]\d{1,2})(?::?(\d{2}))?)?$/);
  if (!m) return null;

  const timePart = m[1];
  let offH = (m[2] !== undefined) ? Number(m[2]) : 9;
  let offM = (m[3] !== undefined) ? Number(m[3]) : 0;

  const sign = offH >= 0 ? '+' : '-';
  offH = Math.abs(offH);
  const offset = `${sign}${String(offH).padStart(2, '0')}:${String(offM).padStart(2, '0')}`;

  const hhmmss = timePart.length === 5 ? `${timePart}:00` : timePart;
  const iso = `${datePart}T${hhmmss}${offset}`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

// update_log.imDae_sheet_timetz 파서 (timestamptz/timetz 모두 지원)
function _parseUpdateLogTime(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?([+-]\d{2}:?\d{2}|Z)?$/.test(s)) {
    const isoLike = s.replace(' ', 'T');
    const d = new Date(isoLike);
    return isNaN(d.getTime()) ? null : d;
  }
  return _timetzToTodayISO(s);
}

// movement별 최신 1건 시간 가져오기
async function getLatestUpdateISO(movement) {
  try {
    const { data, error } = await window.supabase
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

// 메타 스팬에 표기
async function refreshLatestMeta() {
  const meta = document.getElementById('employee-listings-meta');
  if (!meta) return;
  meta.textContent = '불러오는 중…';

  try {
    const maemulAt = await getLatestUpdateISO('매물장');

    if (!maemulAt) {
      meta.textContent = '매물정보 업데이트 기록이 없습니다';
      meta.style.color = ''; // 기본색
      return;
    }

    // 현재 KST 시간
    const now = new Date();
    const nowKST = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));

    // 차이 (밀리초)
    const diffMs = nowKST - maemulAt;
    const diffHours = diffMs / (1000 * 60 * 60);

    // 기본 표기
    meta.textContent = `매물정보 업데이트 :  ${formatDate(maemulAt)}`;

    // 1시간 이상 차이 → 빨간색
    if (diffHours >= 1) {
      meta.style.color = '#FF4D4D';
      meta.style.fontWeight = 'bold';
    } else {
      // 1시간 미만 → 기본색 (원상복구)
      meta.style.color = '';
      meta.style.fontWeight = '';
    }

  } catch {
    meta.textContent = '매물정보 업데이트 기록이 없습니다';
    meta.style.color = ''; // 기본색
  }
}

// 스크립트 시작
// === [추가] '내용' 복사 기능용 헬퍼 ===
function getDescriptionValue(index) {
  const el = document.querySelector(`[data-field="description_${index}"]`);
  if (!el) return '';
  if (el.tagName === 'SPAN') return (el.textContent || '').trim();
  return (el.value || '').trim();
}

function setDescriptionValue(index, value) {
  const el = document.querySelector(`[data-field="description_${index}"]`);
  if (!el) return;
  if (el.tagName === 'SPAN') el.textContent = value ?? '';
  else el.value = value ?? '';
}

/** 현재 50칸의 '매물번호' input들 중 동일 매물번호가 있는 행 index 반환 (없으면 null)
  *   - 비교 시 숫자만 비교 (하이픈/공백 등 무시)
  */
function findRowIndexByListingNumber(listingId, ignoreIndex = null) {
  const cleaned = String(listingId).replace(/[^\d]/g, '');
  if (!cleaned) return null;

  let found = null;
  document.querySelectorAll('input[data-index]').forEach(inp => {
    const idx = parseInt(inp.dataset.index, 10);
    if (ignoreIndex && idx === ignoreIndex) return;
    const val = String(inp.value || '').replace(/[^\d]/g, '');
    if (val && val === cleaned && found === null) {
      found = idx;
    }
  });
  return found;
}

function renderMemoPanel(listings = []) {
  const memoBody = document.getElementById('memo-body');
  if (!memoBody) return;
  memoBody.innerHTML = '';

  // order → memo 매핑 (order가 없으면 인덱스로 가정)
  const memoMap = new Map();
  listings.forEach((it, idx) => {
    const order = (typeof it.order === 'number' && !Number.isNaN(it.order)) ? it.order : (idx + 1);
    memoMap.set(order, typeof it.memo === 'string' ? it.memo : '');
  });

  for (let i = 1; i <= 50; i++) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="p-1 border-b border-gray-200 align-top">
        <div class="flex items-start gap-2 h-full">
          <textarea
            class="w-[18rem] h-full resize-none outline-none bg-transparent text-sm align-top box-border p-1"
            data-memo-index="${i}"
            placeholder="메모 입력"
            rows="1"
            style="height:100%;min-height:0"
          ></textarea>
        </div>
      </td>
    `;
    memoBody.appendChild(tr);

    // 저장된 값 있으면 채움
    const ta = tr.querySelector('textarea[data-memo-index]');
    const val = memoMap.get(i);
    if (ta && typeof val === 'string') ta.value = val;
  }

  syncMemoRowHeights();
}

/** 현재 화면의 메모 N행에서 문자열을 읽어옴 (없으면 빈문자열) */
function getMemoValue(index) {
  const el = document.querySelector(`textarea[data-memo-index="${index}"]`);
  return (el?.value || '').trim();
}

// 현재 있는 모든 행을 관찰
function observeRows() {
  if (!listingsBody) return;
  if (!rowObserver) return;
  rowObserver.disconnect();
  listingsBody.querySelectorAll('tr').forEach(tr => rowObserver.observe(tr));
}

// ✅ data-field 값을 (span / input / textarea 모두에서) 안전하게 읽기
function getFieldValue(field, index) {
  const sel = `[data-field="${field}_${index}"]`;
  const el = document.querySelector(sel);
  if (!el) return '';
  if (el.tagName === 'SPAN') return (el.textContent || '').trim();
  return (el.value || '').trim();
}

// ✅ 공통 세터
function setFieldValue(field, index, value) {
  const el = document.querySelector(`[data-field="${field}_${index}"]`);
  if (!el) return;
  if (el.tagName === 'SPAN') el.textContent = value ?? '';
  else el.value = value ?? '';
}

// ✅ 특정 필드들만 다른 행에서 복사해오기
function copyFieldsFromRow(srcIndex, destIndex, fields) {
  fields.forEach((f) => {
    const v = getFieldValue(f, srcIndex);
    if (v) setFieldValue(f, destIndex, v);
  });
}

// ✅ 왼쪽 매물번호 input에서 번호 읽기
function getListingNumber(index) {
  const input = document.querySelector(`input[data-index="${index}"]`);
  return (input?.value || '').trim();
}

// === 매물번호 중복 체크 & 빨갛게 표시 ===
function highlightDuplicateListingNumbers() {
  const allInputs = [...document.querySelectorAll('input[data-index]')];

  // 값 목록 생성
  const values = allInputs.map(inp => (inp.value || '').trim());

  allInputs.forEach((inp, idx) => {
    const v = values[idx];
    if (!v) {
      // 값이 없으면 색상 초기화
      inp.style.backgroundColor = '';
      inp.style.color = '';
      return;
    }

    // 동일 값이 2개 이상인지 체크
    const isDuplicate = values.filter(x => x === v).length > 1;

    if (isDuplicate) {
      // 빨간 표시
      inp.style.backgroundColor = '#ffe4e4';
      inp.style.color = '#d00';
    } else {
      // 정상 색상 복원
      inp.style.backgroundColor = '';
      inp.style.color = '';
    }
  });
}

// === 실제로 중복이 있는지 여부만 true/false로 알려주는 함수 ===
function hasDuplicateListingNumbers() {
  const allInputs = [...document.querySelectorAll('input[data-index]')];
  const seen = new Set();

  for (const inp of allInputs) {
    const v = (inp.value || '').trim();
    if (!v) continue;
    if (seen.has(v)) {
      return true;  // 이미 본 값이면 중복
    }
    seen.add(v);
  }
  return false;
}

// ✅ 돈 포맷 되어 있는 문자열에서 숫자만 추출(‘억 2,000’ 등도 허용) → 다시 원래 문자열 그대로 쓰길 원하면 이 부분 조정
const stripEmpty = (s) => (s || '').trim();

// (교체) 보증금/월세 라벨을 붙여서 합성
function joinMoney(deposit, monthly) {
  const a = (deposit || '').trim(); // 예: "1억 5,000"
  const b = (monthly || '').trim(); // 예: "800"
  const aL = a ? `${a}` : '';
  const bL = b ? `${b}` : '';
  if (a && b) return `${aL}/${bL}`;
  return aL || bL || '';
}

// ✅ 해당 행에 “의미 있는 값”이 하나라도 있는지 확인 (번호 제외)
function hasMeaningfulData(index) {
  const keys = [
    'listing_title', 'full_address', 'combined_unit', 'deposit_price',
    'monthly_rent', 'premium_price', 'area_py', 'description'
  ];
  return keys.some(k => !!getFieldValue(k, index));
}

// ✅ 한 행을 메시지 4줄로 변환 (주소 뒤 "-" 문제 수정 버전)
function buildMessageForRow(index) {
  const no = getListingNumber(index) || '';
  const title = getFieldValue('listing_title', index) || '-';
  const addr = getFieldValue('full_address', index) || '';
  const unit = getFieldValue('combined_unit', index) || '';   // 상세 주소/호수 정보
  const dep = getFieldValue('deposit_price', index);
  const mon = getFieldValue('monthly_rent', index);
  const prem = getFieldValue('premium_price', index);
  const area = getFieldValue('area_py', index);
  const desc = getFieldValue('description', index);

  // 🔥 주소 + 상세주소(호수) 조합 개선
  // unit(호수/상세주소)이 있을 때만 "-" 를 붙인다
  let line2 = addr.trim();
  if (unit.trim()) {
    line2 = `${line2} - ${unit.trim()}`;
  }
  line2 = line2.trim();

  // 1행
  const line1 = `${title}`.trim();

  // 3행: "면적 보증금/월세 권리금"
  const areaPart = area ? `${area}평` : '';
  const moneyPair = joinMoney(dep, mon); // 보증금/월세
  const premiumTag = prem ? `권${prem}` : '';
  const parts = [areaPart, moneyPair, premiumTag].filter(Boolean);
  const line3 = parts.join(' ');

  // 4행: 설명
  const line4 = desc || '';

  // 5행: URL (매물번호 있을 때)
  const baseUrl = "https://baikuk.com/item/view/";
  const line5 = no ? `${baseUrl}${no}` : '';

  const lines = [line1, line2, line3, line4, line5].filter(l => l !== '');
  return lines.join('\n');
}

// ✅ 전체 행을 훑어 텍스트 생성
function buildAllMessages() {
  const rows = document.querySelectorAll('#listings-body tr');
  const blocks = [];
  rows.forEach((_, i) => {
    const idx = i + 1; // 실제 index
    if (hasMeaningfulData(idx) || getListingNumber(idx)) {
      const msg = buildMessageForRow(idx);
      if (msg) {
        // 🔹 앞에 순서 번호 붙이기
        blocks.push(`${blocks.length + 1}.\n${msg}`);
      }
    }
  });
  const combined = blocks.join('\n\n');
  if (!combined) return '';

  const footer = `✔️ 일산·파주 상가, 부동산마다 매물이 달라서 답답하셨죠?
✔️ 백억지도는 지역 내 모든 매물을 통합하여 정확한 실시간 정보를 제공합니다.
✔️ 창업과 이전의 시작, 백억지도로 가장 신속한 의사결정을 시작하세요.
👉 https://baikuk.com/map`;

  return combined + '\n\n' + footer;
}

// ✅ 클립보드 복사 (표준 + 폴백)
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('링크용 문구를 복사했어요.');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('링크용 문구를 복사했어요.');
    } catch {
      showToast('복사에 실패했습니다. 수동으로 복사해주세요.');
    }
    document.body.removeChild(ta);
  }
}

// 퇴사자 안보이는 관련코드
// ✅ 내 권한/소속 조회
async function getAuthContext() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { me: null, myAuth: null, myAff: null };

  const { data: me, error: meErr } = await supabase
    .from('staff_profiles')
    .select('id, authority, affiliation')
    .eq('user_id', user.id)
    .maybeSingle();

  return {
    me,
    myAuth: me?.authority ?? null,      // '관리자' | '지점장' | '직원'
    myAff: (me?.affiliation ?? '').trim()
  };
}

// ✅ 직원 목록 로딩 (권한별 퇴사자 표시 제어)
async function loadStaffOptions(currentStaffId = null) {
  const staffSelect = document.getElementById('staff-select');
  if (!staffSelect) return;
  staffSelect.innerHTML = '';

  // 권한/소속
  const { me, myAuth, myAff } = await getAuthContext();
  if (!me) return;

  // 1) 기본 쿼리
  let q = supabase
    .from('staff_profiles')
    .select('id, name, affiliation, leave_date')
    .order('affiliation', { ascending: true })
    .order('name', { ascending: true });

  // 2) 권한이 '직원'이면 퇴사자 제외
  if (myAuth === '직원') {
    q = q.is('leave_date', null);
  }

  const { data: staffList, error: staffErr } = await q;
  if (staffErr || !staffList) return;

  // 내가 로그인한 staff id
  const myStaffId = me.id;

  // 3) 소속별 그룹화
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

      // ✅ 우선순위: currentStaffId → 없으면 내 staff id
      if ((currentStaffId && s.id === currentStaffId) || (!currentStaffId && s.id === myStaffId)) {
        opt.selected = true;
      }

      og.appendChild(opt);
    });
    staffSelect.appendChild(og);
  };

  if (myAff && grouped[myAff]) {
    appendGroup(`${myAff} (같은 소속)`, grouped[myAff]);
    delete grouped[myAff];
  }

  Object.entries(grouped).forEach(([aff, members]) => {
    appendGroup(aff, members);
  });
}

// 첫로드시 직원표시 함수
async function loadCurrentUserStaffInfo() {
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) return;

  const userId = user.id;

  // staff_profiles 테이블에서 해당 사용자 정보 조회
  const { data: staff } = await supabase
    .from('staff_profiles')
    .select('id, position, name, phone_num, affiliation')
    .eq('user_id', userId) // 혹은 eq('id', userId) → 실제 구조에 따라 변경
    .maybeSingle();

  if (staff) {
    const staffInfoBox = document.getElementById('staff-info');
    if (staffInfoBox) {
      const displayPosition = staff.name === '권준서' ? '대표' : (staff.position ?? '');
      staffInfoBox.textContent = `${displayPosition} ${staff.name ?? ''} ${staff.phone_num ?? ''}`.trim();
      staffInfoBox.classList.remove('hidden');

      // 지점에 따른 로고 및 크기 변경
      const mainLogo = document.getElementById('main-logo');
      if (mainLogo) {
        const aff = (staff.affiliation || '').trim();
        if (aff === '스타운정점') {
          mainLogo.src = 'https://sfinbtiqlfnaaarziixu.supabase.co/storage/v1/object/public/biakuk-images//starfield-logo.png';
          mainLogo.style.width = '10rem';
        } else if (aff === '1등운정점') {
          mainLogo.src = 'https://sfinbtiqlfnaaarziixu.supabase.co/storage/v1/object/public/biakuk-images//1st_simbol+name9.png';
          mainLogo.style.width = '15rem';
        } else {
          mainLogo.src = 'https://sfinbtiqlfnaaarziixu.supabase.co/storage/v1/object/public/biakuk-images//baikuk-logo-yellow_simbol_name.png';
          mainLogo.style.width = '22rem';
        }
      }
    }

    // 현재 선택된 직원 ID 전역 변수에 저장
    selectedStaffId = staff.id || null;

    // 기존 select UI는 숨김 처리 (혹시 남아있을 경우 대비)
    const staffSelect = document.getElementById('staff-select');
    if (staffSelect) staffSelect.classList.add('hidden');
  }
}

// 직원 이름 클릭 시 직원 리스트 드롭다운
function setupStaffDropdown() {
  const staffInfo = document.getElementById('staff-info');
  const dropdown = document.getElementById('staff-dropdown');
  const container = document.getElementById('staff-info-container');

  if (!staffInfo || !dropdown || !container) return;

  // 드롭다운 닫기
  function closeDropdown() {
    dropdown.classList.add('hidden');
  }

  // 드롭다운 열기 + 직원 리스트 로딩
  async function openDropdown() {
    // 위치 잡기
    const rect = staffInfo.getBoundingClientRect();
    dropdown.style.minWidth = rect.width + 'px';
    dropdown.style.left = rect.left + window.scrollX + 'px';
    dropdown.style.top = rect.bottom + window.scrollY + 4 + 'px';

    dropdown.classList.remove('hidden');
    dropdown.innerHTML = `
      <div class="px-3 py-2 text-sm text-gray-500">
        직원 목록을 불러오는 중입니다...
      </div>
    `;

    const { me, myAuth, myAff } = await getAuthContext();

    if (!me) {
      dropdown.innerHTML = `
        <div class="px-3 py-2 text-sm text-red-500">
          직원 정보를 불러오지 못했습니다.
        </div>
      `;
      return;
    }

    // 직원 목록 조회 (퇴사자 제외)
    const { data: staffList, error } = await supabase
      .from('staff_profiles')
      .select('id, name, position, phone_num, affiliation')
      .is('leave_date', null)   // 퇴사자 제외
      .order('affiliation', { ascending: true })
      .order('name', { ascending: true });

    if (error || !staffList || staffList.length === 0) {
      dropdown.innerHTML = `
        <div class="px-3 py-2 text-sm text-gray-500">
          표시할 직원이 없습니다.
        </div>
      `;
      return;
    }

    // 지점(affiliation)별 그룹화
    const grouped = staffList.reduce((acc, s) => {
      const aff = (s.affiliation || '미지정').trim();
      (acc[aff] ||= []).push(s);
      return acc;
    }, {});

    dropdown.innerHTML = '';

    // 지점 순서 정렬: 내 지점 우선 + 나머지 가나다순
    const sortedAffiliations = Object.keys(grouped).sort((a, b) => {
      if (a === myAff) return -1;   // 현재 지점이 a면 항상 맨 위
      if (b === myAff) return 1;    // 현재 지점이 b면 a보다 아래
      return a.localeCompare(b, 'ko'); // 나머지는 가나다순
    });

    sortedAffiliations.forEach(aff => {
      const group = grouped[aff];

      // 지점 헤더
      const header = document.createElement('div');
      header.className =
        'px-3 py-1 text-xs font-semibold text-gray-500 bg-gray-50 border-b border-gray-100';
      const headerLabel = aff === '미지정' ? '지점 미지정' : `${aff} 지점`;
      header.textContent = headerLabel;
      dropdown.appendChild(header);

      // 직원 목록
      group.forEach(staff => {
        const isSelected = selectedStaffId && selectedStaffId === staff.id;

        const item = document.createElement('button');
        item.type = 'button';
        item.className =
          'w-full text-left px-3 py-2 text-sm hover:bg-gray-100 flex flex-col ' +
          (isSelected ? 'bg-blue-50' : '');

        // 직원 정보 가로 배치
        const row = document.createElement('div');
        row.className = 'flex items-center gap-3 pl-4';

        const namePart = document.createElement('span');
        namePart.className = 'font-medium text-gray-800';
        const displayPosition = staff.name === '권준서' ? '대표' : (staff.position ?? '');
        namePart.textContent = `${displayPosition} ${staff.name ?? ''}`.trim();

        const phonePart = document.createElement('span');
        phonePart.className = 'text-sm text-gray-500';
        phonePart.textContent = staff.phone_num || '';

        row.appendChild(namePart);
        if (staff.phone_num) row.appendChild(phonePart);

        item.appendChild(row);

        item.addEventListener('click', () => {
          selectedStaffId = staff.id;
          const displayPosition = staff.name === '권준서' ? '대표' : (staff.position ?? '');
          staffInfo.textContent = `${displayPosition} ${staff.name ?? ''} ${staff.phone_num ?? ''}`.trim();

          // 지점에 따른 로고 및 크기 변경
          const mainLogo = document.getElementById('main-logo');
          if (mainLogo) {
            const aff = (staff.affiliation || '').trim();
            if (aff === '스타운정점') {
              mainLogo.src = 'https://sfinbtiqlfnaaarziixu.supabase.co/storage/v1/object/public/biakuk-images//starfield-logo.png';
              mainLogo.style.width = '10rem';
            } else if (aff === '1등운정점') {
              mainLogo.src = 'https://sfinbtiqlfnaaarziixu.supabase.co/storage/v1/object/public/biakuk-images//1st_simbol+name.png';
              mainLogo.style.width = '18rem';
            } else {
              mainLogo.src = 'https://sfinbtiqlfnaaarziixu.supabase.co/storage/v1/object/public/biakuk-images//baikuk-logo-yellow_simbol_name.png';
              mainLogo.style.width = '22rem';
            }
          }

          closeDropdown();
        });

        dropdown.appendChild(item);
      });
    });
  }

  // 이름 클릭 → 토글
  staffInfo.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (dropdown.classList.contains('hidden')) {
      await openDropdown();
    } else {
      closeDropdown();
    }
  });

  // 바깥 클릭하면 닫기
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      closeDropdown();
    }
  });
}

// ✅ 내 staff_profiles.id 가져오기
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

// ✅ 내가(대표/보조) 배정된 고객인지 확인 (고객-담당 링크 OR customers.staff_profiles_id)
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

async function loadCustomerDataByName(name, list_name = null) {

  // 1) 고객을 정확히 조회 (이름 + 리스트 조합)
  let query = supabase
    .from("customers")
    .select("*")
    .eq("customer_name", name);

  if (list_name) {
    query = query.eq("list_name", list_name);
  }

  const { data: customer, error } = await query.maybeSingle();

  if (error || !customer) {
    showToast("고객 정보를 불러올 수 없습니다.");
    return;
  }

  // 2) 고객 기본 정보 채우기
  document.getElementById("top-row-input").value = customer.customer_name || "";
  document.getElementById("list-name-input").value = customer.list_name || "";
  document.getElementById("customer-phone").value = customer.customer_phone_number || "";
  document.getElementById("customer-grade").value = customer.grade || "F";
  document.getElementById("memo-textarea").value = customer.memo || "";

  // 숫자 필드들
  const fill = (id, v) => document.getElementById(id).value = v ?? "";
  fill("floor-min", customer.floor_min);
  fill("floor-max", customer.floor_max);
  fill("area-min", customer.area_min);
  fill("area-max", customer.area_max);
  fill("deposit-min", customer.deposit_min);
  fill("deposit-max", customer.deposit_max);
  fill("rent-min", customer.rent_min);
  fill("rent-max", customer.rent_max);
  fill("rent-per-py-min", customer.rent_per_py_min);
  fill("rent-per-py-max", customer.rent_per_py_max);
  fill("premium-min", customer.premium_min);
  fill("premium-max", customer.premium_max);
  fill("sale-min", customer.sale_min);
  fill("sale-max", customer.sale_max);
  fill("total-deposit-min", customer.total_deposit_min);
  fill("total-deposit-max", customer.total_deposit_max);
  fill("total-rent-min", customer.total_rent_min);
  fill("total-rent-max", customer.total_rent_max);
  fill("roi-min", customer.roi_min);
  fill("roi-max", customer.roi_max);

  // 3) 현재 고객 ID 저장
  currentCustomerId = customer.id;

  // 4) 매물 정보 로딩
  await loadListingsForCustomerId(customer.id);
}

async function loadListingsForCustomerId(customerId) {

  // 입력 UI 초기화
  document.querySelectorAll('input[data-index]').forEach(i => i.value = '');
  document.getElementById("listings-body").innerHTML = '';

  const { data: listings, error } = await supabase
    .from("customers_recommendations")
    .select("*")
    .eq("customers_id", customerId)
    .order("order", { ascending: true });

  if (error) {
    showToast("매물 정보를 불러오지 못했습니다.");
    return;
  }

  let nextIndex = 1;

  listings.forEach(listing => {
    const index = listing.order ?? nextIndex++;

    const leftInput = document.querySelector(`input[data-index="${index}"]`);
    if (leftInput) leftInput.value = listing.listing_id ?? "";

    updateListingsTableByInputs();

    const setField = (field, value) => {
      const el = document.querySelector(`[data-field="${field}_${index}"]`);
      if (!el) return;
      if (el.tagName === "SPAN") el.textContent = value ?? "";
      else el.value = value ?? "";
    };

    setField('listing_title', listing.listing_title);
    setField('full_address', listing.full_address);
    setField('deposit_price', formatKoreanMoney(listing.deposit_price));
    setField('monthly_rent', formatKoreanMoney(listing.monthly_rent));
    setField('premium_price', formatKoreanMoney(listing.premium_price));
    setField('area_py', listing.area_py);
    setField('description', listing.contents);

    const memoEl = document.querySelector(`textarea[data-memo-index="${index}"]`);
    if (memoEl) memoEl.value = listing.memo ?? "";
  });
}

async function loadCustomerByNameAndList(name, list_name) {

  const { data: customer, error } = await supabase
    .from("customers")
    .select("*")
    .eq("customer_name", name)
    .eq("list_name", list_name)
    .maybeSingle();

  if (error || !customer) {
    showToast("고객 정보를 불러오지 못했습니다.");
    return;
  }

  // 고객 정보 채우기
  document.getElementById("top-row-input").value = customer.customer_name || "";
  document.getElementById("list-name-input").value = customer.list_name || "";
  document.getElementById("customer-phone").value = customer.customer_phone_number || "";
  document.getElementById("customer-grade").value = customer.grade || "F";
  document.getElementById("memo-textarea").value = customer.memo || "";

  document.getElementById("floor-min").value = customer.floor_min ?? "";
  document.getElementById("floor-max").value = customer.floor_max ?? "";
  document.getElementById("area-min").value = customer.area_min ?? "";
  document.getElementById("area-max").value = customer.area_max ?? "";
  document.getElementById("deposit-min").value = customer.deposit_min ?? "";
  document.getElementById("deposit-max").value = customer.deposit_max ?? "";
  document.getElementById("rent-min").value = customer.rent_min ?? "";
  document.getElementById("rent-max").value = customer.rent_max ?? "";
  document.getElementById("rent-per-py-min").value = customer.rent_per_py_min ?? "";
  document.getElementById("rent-per-py-max").value = customer.rent_per_py_max ?? "";
  document.getElementById("premium-min").value = customer.premium_min ?? "";
  document.getElementById("premium-max").value = customer.premium_max ?? "";
  document.getElementById("sale-min").value = customer.sale_min ?? "";
  document.getElementById("sale-max").value = customer.sale_max ?? "";
  document.getElementById("total-deposit-min").value = customer.total_deposit_min ?? "";
  document.getElementById("total-deposit-max").value = customer.total_deposit_max ?? "";
  document.getElementById("total-rent-min").value = customer.total_rent_min ?? "";
  document.getElementById("total-rent-max").value = customer.total_rent_max ?? "";
  document.getElementById("roi-min").value = customer.roi_min ?? "";
  document.getElementById("roi-max").value = customer.roi_max ?? "";

  // 현재 고객 ID 저장
  currentCustomerId = customer.id;

  // ⭐⭐ 매물 로딩 — 정확한 함수명
  await loadListingsForCurrentCustomer();

}

// 왼쪽패널 고객 + 리스트이름 트리 구조 로딩 (대표/보조 표시 + 등급 그룹 유지)
async function loadCustomersForCurrentStaff() {
  const myId = await getMyStaffId();
  if (!myId) {
    console.error('❌ 로그인된 사용자를 찾을 수 없습니다.');
    return;
  }

  /* ============================================
     1) 고객 목록 가져오기 (대표 고객)
  ============================================ */
  const { data: primaryList, error: pErr } = await supabase
    .from('customers')
    .select('id, customer_name, list_name, grade')
    .eq('staff_profiles_id', myId);

  /* ============================================
     2) 배정자 목록 가져오기 (대표/보조)
  ============================================ */
  const { data: assigneeList, error: aErr } = await supabase
    .from('customers')
    .select(`
      id,
      customer_name,
      list_name,
      grade,
      customer_assignees!inner(staff_profiles_id, is_primary)
    `)
    .eq('customer_assignees.staff_profiles_id', myId);

  if (pErr || aErr) {
    console.error('❌ 고객 목록 불러오기 실패:', pErr || aErr);
    return;
  }

  /* ============================================
     3) 대표 + 배정자 병합 + 역할 표시
  ============================================ */
  const map = new Map();

  (primaryList || []).forEach(c => {
    map.set(c.id, { ...c, role: '대표' });
  });

  (assigneeList || []).forEach(c => {
    const prev = map.get(c.id);
    const role = (c.customer_assignees?.[0]?.is_primary || prev?.role === '대표')
      ? '대표'
      : '보조';

    map.set(c.id, {
      id: c.id,
      customer_name: c.customer_name,
      list_name: c.list_name,
      grade: c.grade,
      role
    });
  });

  let customers = Array.from(map.values());

  /* ============================================
     4) 담당자 2명일 때 내 이름 제외한 상대 이름 표시
  ============================================ */
  const custIds = customers.map(c => c.id);

  const { data: assigneesAll } = await supabase
    .from('customer_assignees')
    .select('customer_id, staff_profiles!inner(id, name)')
    .in('customer_id', custIds);

  const otherNameMap = new Map();
  if (assigneesAll) {
    const byCustomer = new Map();

    assigneesAll.forEach(row => {
      const cid = row.customer_id;
      const sp = row.staff_profiles;
      if (!sp) return;
      if (!byCustomer.has(cid)) byCustomer.set(cid, new Map());
      byCustomer.get(cid).set(sp.id, sp.name);
    });

    byCustomer.forEach((idNameMap, cid) => {
      if (idNameMap.size === 2 && idNameMap.has(myId)) {
        for (const [sid, sname] of idNameMap.entries()) {
          if (sid !== myId) {
            otherNameMap.set(cid, sname);
            break;
          }
        }
      }
    });
  }

  /* ============================================
     5) 등급 그룹별 고객 표시
  ============================================ */
  const container = document.getElementById('customer-list');
  if (!container) return;
  container.innerHTML = '';

  if (!customers.length) {
    container.textContent = '등록된 고객이 없습니다.';
    return;
  }

  const gradeOrder = { 계약: 0, A: 1, B: 2, C: 3, F: 4 };
  const filteredCustomers = customers.filter(c =>
    ['계약', 'A', 'B', 'C', 'F'].includes((c.grade || '').toUpperCase())
  );

  const grouped = filteredCustomers.reduce((acc, c) => {
    const g = (c.grade || '미분류').toUpperCase();
    (acc[g] ||= []).push(c);
    return acc;
  }, {});

  const gradeOrderList = ['계약', 'A', 'B', 'C', 'F'];
  const sortedGrades = [
    ...gradeOrderList.filter(g => grouped[g]?.length),
    ...Object.keys(grouped).filter(g => !gradeOrderList.includes(g))
  ];

  /* ============================================
     6) 렌더링: 고객이름 + 리스트이름 트리화
  ============================================ */
  sortedGrades.forEach(grade => {
    const list = grouped[grade] || [];
    if (!list.length) return;

    const section = document.createElement('div');
    section.className = 'mb-1';
    container.appendChild(section);

    const header = document.createElement('div');
    header.className = 'grade-header flex items-center justify-between cursor-pointer select-none';
    header.innerHTML = `
      <span>${grade} (${list.length})</span>
      <span class="caret text-gray-600 transition-transform duration-200">▼</span>
    `;
    section.appendChild(header);

    const listBox = document.createElement('div');
    listBox.className = 'mt-1';
    section.appendChild(listBox);

    // F는 기본 접힘
    const isF = grade === 'F';
    if (isF) {
      listBox.style.display = 'none';
      header.querySelector('.caret').style.transform = 'rotate(-90deg)';
    }

    /* ---- 고객이름 그룹 구성 ---- */
    const customersByName = {};

    list.forEach(c => {
      if (!customersByName[c.customer_name]) {
        customersByName[c.customer_name] = {
          info: c,
          lists: []
        };
      }
      customersByName[c.customer_name].lists.push(c.list_name);
    });

    /* ⭐ 고객이름 내림차순 정렬 */
    const sortedCustomerGroups = Object.values(customersByName).sort(
      (a, b) => b.info.customer_name.localeCompare(a.info.customer_name, "ko")
    );

    /* ---- 고객이름 렌더링 ---- */
    sortedCustomerGroups.forEach(group => {
      const cust = group.info;

      const custBlock = document.createElement("div");
      custBlock.className = "customer-block mb-1";

      const nameRow = document.createElement("div");
      nameRow.className = "customer-name font-bold cursor-pointer";

      const other = otherNameMap.get(cust.id);
      const otherText = other ? `(${other})` : "";

      nameRow.textContent = `${cust.customer_name} ${otherText}`;
      custBlock.appendChild(nameRow);

      // ⭐ 고객명 클릭 시 → 첫 번째 리스트 자동 선택
      nameRow.addEventListener("click", () => {

        const sub = custBlock.querySelector(".customer-sublist");

        // 리스트 아이템 수 가져오기
        const listItems = custBlock.querySelectorAll(".customer-list-item");
        const listCount = listItems.length;

        // ⭐ 리스트가 2개 이상일 때만 펼치기 / 접기 토글
        if (sub && listCount >= 2) {
          sub.classList.toggle("hidden");
        }

        // ⭐ 리스트가 1개 이상 있으면 첫 번째 리스트 선택 자동 실행
        const firstListItem = listItems[0];
        if (firstListItem) {
          // 기존 선택 제거
          document.querySelectorAll(".customer-list-item.selected")
            .forEach(el => el.classList.remove("selected"));

          // 선택 표시
          firstListItem.classList.add("selected");

          // 리스트 이름 파싱 (“- 리스트명” → “리스트명”)
          const firstListName = firstListItem.textContent.replace(/^- /, "").trim();

          // 고객 데이터 자동 로드
          loadCustomerDataByName(cust.customer_name, firstListName);
        }
      });

      // 리스트 wrapper
      const sublist = document.createElement("div");
      sublist.className = "customer-sublist hidden ml-3 mt-1";
      custBlock.appendChild(sublist);

      // 리스트 렌더링
      group.lists.forEach(listName => {
        const listItem = document.createElement("div");
        listItem.className = "customer-list-item pl-4 cursor-pointer text-gray-700 hover:underline";
        listItem.textContent = `- ${listName}`;

        listItem.addEventListener("click", (e) => {
          e.stopPropagation();

          // ⭐ 기존 선택 제거
          document.querySelectorAll(".customer-list-item.selected")
            .forEach(el => el.classList.remove("selected"));

          // ⭐ 현재 클릭된 리스트 강조
          listItem.classList.add("selected");

          // 고객 정보 불러오기
          loadCustomerDataByName(cust.customer_name, listName);
        });

        sublist.appendChild(listItem);
      });

      listBox.appendChild(custBlock);
    });

    /* 등급 그룹 접기/펼치기 */
    header.addEventListener('click', () => {
      const visible = listBox.style.display !== 'none';
      listBox.style.display = visible ? 'none' : '';
      header.querySelector('.caret').style.transform =
        visible ? 'rotate(-90deg)' : 'rotate(0deg)';
    });
  });
}

let buildingMap = new Map();

// 매물번호 입력에 따라 매물정보 표 늘리고 줄이기
function updateListingsTableByInputs() {
  const listingsBody = document.getElementById('listings-body');
  const allInputs = document.querySelectorAll('input[data-index]');

  // 입력된 data-index 중 최대값 찾기 (빈칸은 무시)
  let maxIndex = 0;
  allInputs.forEach(input => {
    const val = input.value.trim();
    const idx = parseInt(input.dataset.index);
    if (val !== '' && !isNaN(idx)) {
      maxIndex = Math.max(maxIndex, idx);
    }
  });

  // 기존 행 수
  const currentRows = listingsBody.children.length;

  // 행이 부족하면 추가
  for (let i = currentRows + 1; i <= maxIndex; i++) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="p-2 border text-center relative">
        ${i}
        <input type="hidden" data-field="color_${i}" value="">
        <input type="hidden" data-field="strike_${i}" value=""> 
        <button 
          class="color-picker-btn absolute right-1 top-1 w-3 h-3 rounded-full border border-gray-400"
          data-index="${i}"
        ></button>
      </td>
      <td class="p-1 border text-center">
        <span contenteditable="true" class="text-base block" data-field="listing_title_${i}"></span>
      </td>
      <td class="p-1 border text-center">
        <span contenteditable="true" class="text-base block" data-field="full_address_${i}"></span>
      </td>
      <td class="p-1 border text-center">
        <span contenteditable="true" class="text-base block" data-field="deposit_price_${i}"></span>
      </td>
      <td class="p-1 border text-center">
        <span contenteditable="true" class="text-base block" data-field="monthly_rent_${i}"></span>
      </td>
      <td class="p-1 border text-center">
        <span contenteditable="true" class="text-base block" data-field="premium_price_${i}"></span>
      </td>
      <td class="p-1 border text-center">
        <span contenteditable="true" class="text-base block" data-field="area_py_${i}"></span>
      </td>
      <td class="p-1 border text-center">
        <span contenteditable="true" class="text-base block" data-field="description_${i}"></span>
      </td>
    `;

    listingsBody.appendChild(row);
    applyRowStriping(); // ⬅ 새 행 추가 후에도 적용
  }

  // 행이 너무 많으면 자름
  while (listingsBody.children.length > maxIndex) {
    listingsBody.removeChild(listingsBody.lastChild);
  }

  // ⬇️ 행 증감 이후 관찰 재설정 + 최종 동기화
  observeRows();
  syncRowHeights();
}

(function setupColumnResizeSync() {
  const box = document.getElementById('white-box');
  const headerRow = document.querySelector('#white-box thead tr');

  if (!headerRow) return;

  const handles = headerRow.querySelectorAll('.resize-handle');

  handles.forEach(handle => {
    let startX = 0;
    let startWidth = 0;
    let th = handle.parentElement;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = th.offsetWidth;

      function onMouseMove(ev) {
        const delta = ev.clientX - startX;
        const newWidth = Math.max(40, startWidth + delta);
        th.style.width = newWidth + 'px';

        // 테이블 전체 너비 계산
        const table = document.querySelector('#white-box table');
        const tableWidth = table.offsetWidth;

        // white-box의 신규 width = 테이블너비 + 기존 여백
        box.style.width = (tableWidth + whiteBoxExtraGap) + 'px';
      }

      function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        // 리사이즈 종료 후 여백 재측정
        const table = document.querySelector('#white-box table');
        const tableWidth = table.offsetWidth;
        const boxWidth = box.offsetWidth;

        whiteBoxExtraGap = boxWidth - tableWidth;
      }

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  });
})();

function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = message;

  // 스타일 직접 지정
  toast.style.backgroundColor = '#F2C130';
  toast.style.color = 'black';
  toast.style.fontWeight = 'bold';
  toast.className = 'fixed top-5 left-1/2 transform -translate-x-1/2 px-4 py-2 rounded shadow-lg z-[9999]';

  toast.classList.remove('hidden');

  setTimeout(() => {
    toast.classList.add('hidden');
  }, duration);
}

// 🧭 파비콘 옆 탭 제목 업데이트
function setDocumentTitle(name) {
  document.title = (name && name.trim()) ? name.trim() : '임대추천';
}

// --- Formatting Helpers ---
function formatKoreanMoney(value) {
  if (value === null || value === undefined || value === '') return '-';
  const num = Number(value);
  if (isNaN(num)) return '-';
  return num.toLocaleString('ko-KR'); // 1,000 단위 콤마 표시
}

// === Listing Title Cleaner ===
// 규칙: 괄호 안에 '숫자'와 '호'가 함께 있으면 그 괄호 묶음만 제거.
// 그 외의 괄호(예: '(전,소담스레김치찌개)')는 유지.
function cleanListingTitle(raw) {
  if (!raw) return '';
  let s = String(raw);

  // 모든 괄호 묶음을 순회하면서, 내부에 숫자(\d)와 '호'가 모두 있으면 제거
  s = s.replace(/\s*\(([^)]*)\)\s*/g, (match, inside) => {
    const hasDigit = /\d/.test(inside);
    const hasHo = /호/.test(inside);
    // 101~103호 같은 범위도 자연스럽게 포함됨(숫자+호)
    return (hasDigit && hasHo) ? '' : ` (${inside.trim()}) `;
  });

  // 남은 공백/중복 공백 정리
  s = s.replace(/\s{2,}/g, ' ').trim();

  // 빈 괄호가 남았으면 제거
  s = s.replace(/\(\s*\)/g, '').trim();

  return s;
}

async function preloadBuildingInfo() {
  const { data: buildings, error } = await supabase
    .from('building_info')
    .select('addr_compare, building_name');

  if (!error && buildings) {
    buildingMap = new Map(buildings.map(b => [b.addr_compare, b.building_name]));
    // console.log(`🏢 building_info ${buildings.length}건 로드 완료`);
  } else {
    console.warn('❗ building_info 로딩 실패:', error);
  }
}

const leftTbody = document.getElementById('left-tbody');
for (let i = 1; i <= 50; i++) {
  const row = document.createElement('tr');
  row.innerHTML = `
    <td class="border-b text-right pr-2"> <!-- 오른쪽 정렬 -->
      <input type="text" placeholder="입력 ${i}" 
            class="w-[5rem] border px-2 rounded text-base ml-auto block" 
            data-index="${i}" />
    </td>
  `;
  leftTbody.appendChild(row);
}


function addListingRow(i) {
  const row = document.createElement('tr');
  const listingsBody = document.getElementById('listings-body');

  // i가 홀수면 흰색, 짝수면 회색
  const bgClass = i % 2 === 0 ? 'bg-gray-50' : 'bg-white';
  row.className = `${bgClass} hover:bg-yellow-50`;

  row.innerHTML = `
    <td class="p-2 border text-center relative">
      ${i}
      <button 
        class="color-picker-btn absolute right-1 top-1 w-3 h-3 rounded-full border border-gray-400"
        data-index="${i}"
      ></button>
    </td>
    <td class="p-2 border text-center"><input type="text" class="w-full text-center text-base border-none bg-transparent outline-none" data-field="listing_title_${i}" /></td>
    <td class="p-2 border text-center"><input type="text" class="w-full text-center text-base border-none bg-transparent outline-none" data-field="full_address_${i}" /></td>
    <td class="p-2 border text-center"><input type="text" class="w-full text-center text-base border-none bg-transparent outline-none" data-field="building_name_${i}" /></td>
    <td class="p-2 border text-center"><input type="text" class="w-full text-center text-base border-none bg-transparent outline-none" data-field="unit_info_${i}" /></td>
    <td class="p-2 border text-center"><input type="text" class="w-full text-center text-base border-none bg-transparent outline-none" data-field="floor_${i}" /></td>
    <td class="p-2 border text-center"><input type="text" class="w-full text-center text-base border-none bg-transparent outline-none" data-field="deposit_price_${i}" /></td>
    <td class="p-2 border text-center"><input type="text" class="w-full text-center text-base border-none bg-transparent outline-none" data-field="monthly_rent_${i}" /></td>
    <td class="p-2 border text-center"><input type="text" class="w-full text-center text-base border-none bg-transparent outline-none" data-field="premium_price_${i}" /></td>
    <td class="p-2 border text-center"><input type="text" class="w-full text-center text-base border-none bg-transparent outline-none" data-field="area_py_${i}" /></td>
  `;

  listingsBody.appendChild(row);
  applyRowStriping(); // ⬅ 새 행 추가 후에도 적용
}

function applyRowStriping() {
  const rows = document.querySelectorAll('#listings-body tr');

  rows.forEach((row, index) => {

    // 🎯 사용자가 색을 지정한 경우 → 줄무늬 적용 금지
    if (row.dataset.userColor === "true") return;

    // 기존 줄무늬 적용
    row.classList.remove('bg-white', 'bg-gray-50');
    row.style.backgroundColor = ""; // inline 색 제거
    row.classList.add(index % 2 === 0 ? 'bg-white' : 'bg-gray-50');
  });
}

// 매물정보 지우는 함수
function clearListingRow(index) {
  const fields = [
    'listing_title', 'full_address',
    'deposit_price', 'monthly_rent', 'premium_price', 'area_py', 'description'
  ];

  fields.forEach(field => {
    const el = document.querySelector(`[data-field="${field}_${index}"]`);
    if (el) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.value = '';
      } else {
        el.textContent = '';
      }
    }
  });

  // memo도 같이 지우기
  const memoEl = document.querySelector(`textarea[data-memo-index="${index}"]`);
  if (memoEl) memoEl.value = '';

  // 행 색상 초기화
  const tr = document.querySelector(`#listings-body tr:nth-child(${index})`);
  if (tr) {
    tr.style.backgroundColor = "";
    tr.dataset.userColor = "";
  }
  setFieldValue("color", index, "");

  syncRowHeights?.();
}

async function fetchListingInfo(listingId, rowIndex) {
  const cleanedId = listingId.replace(/[^\d]/g, '');  // 숫자만 남기기

  if (!cleanedId) {
    console.warn(`[${rowIndex}] 매물번호가 비어있습니다.`);
    return;
  }

  const numericId = Number(cleanedId.replaceAll(',', '')); // 쉼표 제거 + 숫자 변환

  if (isNaN(numericId)) {
    alert(`유효한 숫자 매물번호를 입력해주세요.`);
    return;
  }

  // Supabase 조회
  const { data: listing, error: listingError } = await supabase
    .from('baikukdbtest')
    .select('listing_title, full_address, addr_compare, unit_info, floor, deposit_price, monthly_rent, premium_price, area_py')
    .eq('listing_id', numericId)
    .single();

  if (listingError || !listing) {
    console.error(`❌ [${rowIndex}] 매물 조회 실패`, listingError);
    showToast(`매물번호 ${listingId} 를 찾을 수 없습니다.`);
    return;
  }

  // 2. 건물명 매핑
  const buildingName = buildingMap.get(listing.addr_compare) ?? '-';

  // 3. 표시할 데이터 정리
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

  // 4. DOM에 출력
  Object.entries(dataToDisplay).forEach(([field, value]) => {
    const selector = `[data-field="${field}_${rowIndex}"]`;
    const el = document.querySelector(selector);
    if (el) {
      const isMoney = ['deposit_price', 'monthly_rent', 'premium_price'].includes(field);
      const formattedValue =
        isMoney
          ? formatKoreanMoney(value)
          : field === 'area_py'
            ? (isNaN(Number(value)) ? '-' : Number(value).toFixed(1))
            : field === 'full_address'
              ? (typeof value === 'string' ? value.split(' ').slice(1).join(' ') : '-')
              : (value ?? '-');

      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.value = formattedValue;
      } else {
        el.textContent = formattedValue;  // ✅ span 태그용
      }
    }
  });

  // ✅ 높이 동기화 실행
  syncRowHeights();
  applyRowStriping();  // ✅ 행 배경색 다시 적용      
}


window.addEventListener('DOMContentLoaded', () => {
  displayTodayDate();
  displayStaffInfo();
  preloadBuildingInfo();
  loadCustomersForCurrentStaff();
  loadCurrentUserStaffInfo(); // 첫로드시 담당자정보 본인정보 표시
  loadStaffOptions();
  refreshLatestMeta(); // [ADD] 매물장 최신 업데이트 시간 갱신
  setupStaffDropdown();

  // ⭐ staff-dropdown 을 body로 이동 (부모 overflow 영향 안 받게)
  const dropdown = document.getElementById('staff-dropdown');
  if (dropdown && dropdown.parentElement !== document.body) {
    document.body.appendChild(dropdown);
  }

  // === 행 높이 동기화를 위한 행 단위 관찰 초기화 ===
  listingsBody = document.getElementById('listings-body');
  rowObserver = new ResizeObserver(() => {
    // 행 하나가 커지거나 작아질 때마다 전체 동기화 (간단/안전)
    syncRowHeights();
  });
  observeRows();   // 현재 있는 모든 행 관찰 시작

  const memoTextarea = document.getElementById('memo-textarea');

  document.querySelectorAll('input[data-index]').forEach(input => {
    const index = parseInt(input.dataset.index, 10);

    // 공통 처리: 입력값에 따라 조회
    // - 빈칸: 행 초기화
    // - 중복: 기존행에서 4개(매물명/주소/건물정보/내용) 복사
    // - 비중복: ⚠ 무조건 '내용' 먼저 비우고 → DB 값 반영
    const handleListingInput = async (rowIndex, rawValue) => {
      const value = (rawValue || '').trim();

      if (value === '') {
        clearListingRow(rowIndex);
        const inputEl = document.querySelector(`input[data-index="${rowIndex}"]`);
        if (inputEl) inputEl.dataset.prev = ''; // (선택) 이전 번호 기록 초기화
        return;
      }

      // 동일 매물번호 기존 행 찾기 (본인 행 제외)
      const dupeIndex = findRowIndexByListingNumber(value, rowIndex);

      // ✅ 비중복이면 '내용'을 항상 먼저 비움(최초 입력 포함)
      if (!dupeIndex) {
        setFieldValue('description', rowIndex, '');
      }

      // DB에서 매물정보 채우기(보증금/월세/권리금/평수 등 최신값)
      await fetchListingInfo(value, rowIndex);

      // ✅ 중복이면 기존 행에서 4개 필드 덮어쓰기
      if (dupeIndex) {
        const dupes = {
          listing_title: getFieldValue('listing_title', dupeIndex),
          full_address: getFieldValue('full_address', dupeIndex),
          description: getFieldValue('description', dupeIndex),
        };
        setFieldValue('listing_title', rowIndex, dupes.listing_title ?? '');
        setFieldValue('full_address', rowIndex, dupes.full_address ?? '');
        setFieldValue('combined_unit', rowIndex, dupes.combined_unit ?? '');
        setFieldValue('description', rowIndex, dupes.description ?? '');

        // 메모도 같이 복사
        const srcMemo = getMemoValue(dupeIndex);
        const destMemoEl = document.querySelector(`textarea[data-memo-index="${rowIndex}"]`);
        if (destMemoEl) destMemoEl.value = srcMemo ?? '';

        showToast('기존 행을 복사');
      }
      highlightDuplicateListingNumbers();
    };

    // 단일 변경
    input.addEventListener('change', async (e) => {
      await handleListingInput(index, e.target.value);
    });

    // Enter로 확정
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        await handleListingInput(index, e.target.value);

        // 다음 칸으로 포커스
        const nextInput = document.querySelector(`input[data-index="${index + 1}"]`);
        if (nextInput) nextInput.focus();
      }
    });

    // 여러 개 붙여넣기 (세로/가로/쉼표/공백 구분)
    input.addEventListener('paste', async (e) => {
      e.preventDefault();
      const pasteText = (e.clipboardData || window.clipboardData).getData('text');
      const values = pasteText
        .split(/[\s,\n]+/)
        .map(str => str.trim())
        .filter(Boolean);

      // 순서대로 채우며 각 칸 처리
      for (let offset = 0; offset < values.length; offset++) {
        const targetIndex = index + offset;
        const targetInput = document.querySelector(`input[data-index="${targetIndex}"]`);
        if (!targetInput) break;

        targetInput.value = values[offset];

        // 각 칸 처리 시에도 동일 매물번호라면 '내용' 복사
        await handleListingInput(targetIndex, values[offset]);
      }

      // 붙여넣기 끝나면 마지막 칸 다음으로 포커스
      const lastIndex = index + values.length;
      const nextInput = document.querySelector(`input[data-index="${lastIndex}"]`);
      if (nextInput) nextInput.focus();
    });
  });

  // ✅ 열 리사이즈
  let startX, startWidth, resizableTh;
  document.querySelectorAll('.resize-handle').forEach(h => {
    h.addEventListener('mousedown', e => {
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

  syncRowHeights?.();

  // 전체선택: '매물번호'만 (왼쪽 input[data-index])
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t.matches('input[data-index]')) {
      // iOS/Safari 일부 이슈 방지용
      setTimeout(() => {
        try { t.select(); } catch (_) { }
      }, 0);
    }
  });

  // === '매물번호' 일괄 지우기 버튼 ===
  document.getElementById('clear-left-btn')?.addEventListener('click', () => {
    const inputs = document.querySelectorAll('input[data-index]');
    let touched = 0;
    inputs.forEach(inp => {
      if (inp.value && inp.value.trim() !== '') {
        inp.value = '';
        // 기존 change 핸들러가 clearListingRow(index)를 호출하도록 이벤트 발생
        inp.dispatchEvent(new Event('change'));
        touched++;
      }
    });
    showToast(touched > 0 ? '매물번호를 모두 지웠습니다.' : '지울 매물번호가 없습니다.');
  });

  // 최초 진입 시에도 메모 50줄 표시
  renderMemoPanel([]);
});



// 👉 창 리사이즈 시에도 높이 동기화
window.addEventListener('resize', syncRowHeights);

function syncRowHeights() {
  const rightRows = document.querySelectorAll('#listings-body tr');
  const leftRows = document.querySelectorAll('#left-tbody tr');

  const len = Math.min(rightRows.length, leftRows.length);
  for (let i = 0; i < len; i++) {
    const r = rightRows[i];
    const l = leftRows[i];
    if (!r || !l) continue;

    // 높이 재설정
    l.style.height = 'auto';
    r.style.height = 'auto';

    const lh = l.getBoundingClientRect().height;
    const rh = r.getBoundingClientRect().height;

    const max = Math.max(lh, rh);

    // ✅ 오른쪽이 더 작으면 오른쪽에 높이 고정 (왼쪽이 기준)
    if (rh < lh) r.style.height = `${lh}px`;

    // ✅ 왼쪽은 항상 오른쪽 높이로 맞춤
    l.style.height = `${Math.max(lh, rh)}px`;
  }
  syncMemoRowHeights();
}

function syncMemoRowHeights() {
  const listingRows = document.querySelectorAll('#listings-body tr');
  const memoRows = document.querySelectorAll('#memo-body tr');

  const count = Math.min(listingRows.length, memoRows.length);
  for (let i = 0; i < count; i++) {
    const h = listingRows[i].offsetHeight; // 매물 행의 "최종 총높이"(패딩/보더 반영, 정수 px)
    const td = memoRows[i].querySelector('td');
    if (!td) continue;

    // TD 자체를 동일 높이로 고정
    td.style.height = `${h}px`;

    // 내부 textarea가 TD를 꽉 채우게
    const ta = td.querySelector('textarea');
    if (ta) {
      ta.style.height = '100%';
      ta.style.maxHeight = 'none';
    }
  }
}

const allInputs = document.querySelectorAll('input[data-index]');

const inputTopRow = document.getElementById('top-row-input'); // 손님이름 입력창

// 건물정보, 호수, 층 하나로 합치는 함수
function combineUnitInfo(buildingName, floor, unitInfo) {
  const parts = [];

  if (buildingName && buildingName !== '-') {
    parts.push(buildingName);
  }

  if (floor && floor !== '-') {
    const floorStr = String(floor);
    parts.push(floorStr.endsWith('층') ? floorStr : floorStr + '층');
  }

  if (unitInfo && unitInfo !== '-') {
    const unitStr = String(unitInfo).trim();
    const endsWithHo = unitStr.endsWith('호');
    const endsWithIlbu = unitStr.endsWith('일부');
    const containsJeonche = unitStr.includes('전체');

    const displayUnit = (endsWithHo || endsWithIlbu || containsJeonche)
      ? unitStr
      : unitStr + '호';

    parts.push(displayUnit);
  }

  return parts.join(' ');
}

// 이미지 옆 오늘 날짜 출력
function displayTodayDate() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');

  const dateStr = `${yyyy}-${mm}-${dd}`; // 예: 2025-08-04
  const dateEl = document.getElementById('today-date');
  if (dateEl) dateEl.textContent = dateStr;
}

// 이미지 옆 담당자 정보 출력
async function displayStaffInfo() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    console.warn('❌ 로그인 정보를 가져올 수 없습니다:', userError);
    return;
  }

  const { data: staff, error: staffError } = await supabase
    .from('staff_profiles')
    .select('position, name, phone_num')
    .eq('user_id', user.id)
    .maybeSingle();

  if (staffError || !staff) {
    console.warn('❌ staff_profiles 조회 실패:', staffError);
    return;
  }

  const text = `${staff.position} ${staff.name} ${staff.phone_num}`;
  const el = document.getElementById('staff-info');
  if (el) el.textContent = text;
}

// === 손님 삭제 버튼 ===
document.getElementById('delete-customer')?.addEventListener('click', async () => {
  try {
    if (!currentCustomerId) { showToast('먼저 고객을 선택해주세요.'); return; }

    // 권한 체크: 대표/보조만 삭제 가능
    if (!(await isMyAssignedCustomer(currentCustomerId))) {
      showToast('담당자가 아닌 고객은 삭제할 수 없습니다.');
      return;
    }

    const name = (document.getElementById('top-row-input')?.value || '').trim();
    const listName = (document.getElementById('list-name-input')?.value || '').trim();
    const ok = confirm(`"${name}" - "${listName}" 를 삭제할까요?`);

    if (!ok) return;

    // 1) 연관 데이터부터 삭제 (FK 충돌 방지)
    const { error: recErr } = await supabase
      .from('customers_recommendations')
      .delete()
      .eq('customers_id', String(currentCustomerId)); // text 컬럼이라 문자열 비교

    if (recErr) {
      console.error('추천매물 삭제 실패:', recErr);
      showToast('추천 매물 삭제 중 오류가 발생했습니다.');
      return;
    }

    const { error: assErr } = await supabase
      .from('customer_assignees')
      .delete()
      .eq('customer_id', currentCustomerId);

    if (assErr) {
      console.error('담당 배정 삭제 실패:', assErr);
      showToast('담당 배정 삭제 중 오류가 발생했습니다.');
      return;
    }

    // 2) 고객 삭제
    const { error: custErr } = await supabase
      .from('customers')
      .delete()
      .eq('id', currentCustomerId);

    if (custErr) {
      console.error('고객 삭제 실패:', custErr);
      showToast('고객 삭제 중 오류가 발생했습니다.');
      return;
    }

    // 3) UI 초기화
    currentCustomerId = null;

    // 입력값들 초기화
    document.getElementById('top-row-input').value = '';
    document.getElementById('customer-phone').value = '';
    document.getElementById('customer-grade').value = 'F';
    document.getElementById('memo-textarea').value = '';

    setDocumentTitle('');

    // 왼쪽 매물번호 전체 비우기(+change 디스패치로 오른쪽도 정리)
    document.querySelectorAll('input[data-index]').forEach(inp => {
      if (inp.value && inp.value.trim() !== '') {
        inp.value = '';
        inp.dispatchEvent(new Event('change'));
      }
    });

    // 오른쪽 표 강제 초기화(보호적)
    const listingsBodyEl = document.getElementById('listings-body');
    if (listingsBodyEl) listingsBodyEl.innerHTML = '';

    // (추가) 메모 패널 비우기
    const memoBody = document.getElementById('memo-body');
    if (memoBody) memoBody.innerHTML = '';

    // 직원 표시/선택 UI 정리
    document.getElementById('staff-info')?.classList.add('hidden');
    document.getElementById('staff-select')?.classList.add('hidden');

    // 왼쪽 고객 목록 새로고침
    loadCustomersForCurrentStaff?.();

    showToast('고객을 삭제했습니다.');
  } catch (e) {
    console.error('삭제 처리 중 예외:', e);
    showToast('삭제 처리 중 오류가 발생했습니다.');
  }

  loadCustomersForCurrentStaff();
});

// ✅ 버튼 이벤트
document.getElementById('copy-link-btn')?.addEventListener('click', () => {
  const text = buildAllMessages();
  if (!text) {
    showToast('복사할 내용이 없습니다.');
    return;
  }
  copyToClipboard(text);
});

let wasEditModeForPrint = false;
let portalEl = null;

function buildPrintPortal() {
  // 기존 포털 제거
  portalEl?.remove();

  // white-box 전체를 대상으로 변경
  const src = document.getElementById("white-box");
  if (!src) return;

  // 인쇄용 포털 생성
  portalEl = document.createElement("div");
  portalEl.id = "print-portal";
  portalEl.style.margin = "0";
  portalEl.style.padding = "0";

  // white-box 전체 복제(자식 + 스타일 포함)
  const cloned = src.cloneNode(true);

  // 인쇄용에서 불필요한 요소 제거 (오른쪽 resize handle 등)
  const resizeHandle = cloned.querySelector("#whitebox-resize-handle");
  if (resizeHandle) resizeHandle.remove();

  // white-box의 실제 width 유지
  const originalWidth = src.offsetWidth;
  cloned.style.width = originalWidth + "px";

  // 인쇄용 top-position, absolute 등 초기화(인쇄 시 흐트러짐 방지)
  cloned.style.position = "static";
  cloned.style.left = "0";
  cloned.style.top = "0";
  cloned.style.margin = "0";

  // print-portal에 넣기
  portalEl.appendChild(cloned);
  document.body.appendChild(portalEl);

  // ★ 인쇄용 테이블의 행 배경색을 강제로 inline style 로 고정 ★
  const trs = cloned.querySelectorAll("tbody tr");
  trs.forEach((tr) => {
    const color = tr.style.backgroundColor;
    if (color) {
      tr.style.setProperty("background-color", color, "important");
    }
  });
}

function cleanupPrintPortal() {
  // 포털 제거
  portalEl?.remove();
  portalEl = null;

  // 줄무늬/높이 다시 맞춤(보호적 호출)
  applyRowStriping?.();
  syncRowHeights?.();
}

window.addEventListener('beforeprint', buildPrintPortal);
window.addEventListener('afterprint', cleanupPrintPortal);

// 세로인쇄
document.getElementById('print-btn')?.addEventListener('click', () => {
  buildPrintPortal();   // 혹시 beforeprint 못 받는 브라우저 보정
  window.print();
  // 일부 브라우저 보정
  setTimeout(cleanupPrintPortal, 0);
});

// 가로인쇄
document.getElementById('print-btn2')?.addEventListener('click', () => {
  // 1) A4 가로 스타일 주입
  const style = document.createElement("style");
  style.id = "landscape-style";
  style.innerHTML = `
    @media print {
      @page { size: A4 landscape; margin: 12mm; }
    }
  `;
  document.head.appendChild(style);

  // 2) 포털 생성 → 인쇄 실행
  buildPrintPortal();
  window.print();

  // 3) 인쇄 후 가로 스타일 제거 + cleanup
  setTimeout(() => {
    document.getElementById("landscape-style")?.remove();
    cleanupPrintPortal();
  }, 100);
});

// 이미지 저장 (단일 이미지로 저장)
document.getElementById('print-btn3')?.addEventListener('click', async () => {
  const whiteBox = document.getElementById('white-box');
  if (!whiteBox) {
    showToast('저장할 내용을 찾을 수 없습니다.');
    return;
  }

  // 리사이즈 핸들 일시적으로 숨김
  const resizeHandle = whiteBox.querySelector('#whitebox-resize-handle');
  if (resizeHandle) resizeHandle.style.visibility = 'hidden';

  // 로딩 표시 (필요 시)
  showToast('이미지를 생성 중입니다...');

  try {
    // html2canvas 실행
    const canvas = await html2canvas(whiteBox, {
      useCORS: true,
      scale: 2, // 고해상도
      backgroundColor: '#ffffff', // 배경색 명시
      logging: false,
      onclone: (clonedDoc) => {
        // 이미지 저장 시에만 하단 여백을 살짝 추가 (기본 p-1/4px 에서 2px 더 추가)
        const cells = clonedDoc.querySelectorAll('#white-box td, #white-box th');
        cells.forEach(cell => {
          cell.style.paddingBottom = '20px';
        });
      }
    });

    // 파일명 생성: 임대추천_YYYYMMDD_HHMMSS
    const now = new Date();
    const Y = now.getFullYear();
    const M = String(now.getMonth() + 1).padStart(2, '0');
    const D = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const filename = `임대추천_${Y}${M}${D}_${h}${m}${s}.png`;

    // 다운로드 링크 생성 및 클릭
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('이미지 저장이 완료되었습니다.');
  } catch (err) {
    console.error('이미지 저장 오류:', err);
    showToast('이미지 저장 중 오류가 발생했습니다.');
  } finally {
    // 리사이즈 핸들 다시 표시
    if (resizeHandle) resizeHandle.style.visibility = 'visible';
  }
});

document.getElementById("save-new-customer").addEventListener("click", async () => {
  const name = document.getElementById("top-row-input").value.trim();
  const list_name = document.getElementById("list-name-input").value.trim();
  const phone = document.getElementById("customer-phone").value.trim();
  const grade = document.getElementById("customer-grade").value.trim();
  const memo = document.getElementById("memo-textarea").value.trim();

  const floor_min = Number(document.getElementById("floor-min").value) || null;
  const floor_max = Number(document.getElementById("floor-max").value) || null;
  const area_min = Number(document.getElementById("area-min").value) || null;
  const area_max = Number(document.getElementById("area-max").value) || null;
  const deposit_min = Number(document.getElementById("deposit-min").value) || null;
  const deposit_max = Number(document.getElementById("deposit-max").value) || null;
  const rent_min = Number(document.getElementById("rent-min").value) || null;
  const rent_max = Number(document.getElementById("rent-max").value) || null;
  const rent_per_py_min = Number(document.getElementById("rent-per-py-min").value) || null;
  const rent_per_py_max = Number(document.getElementById("rent-per-py-max").value) || null;
  const premium_min = Number(document.getElementById("premium-min").value) || null;
  const premium_max = Number(document.getElementById("premium-max").value) || null;
  const sale_min = Number(document.getElementById("sale-min").value) || null;
  const sale_max = Number(document.getElementById("sale-max").value) || null;
  const total_deposit_min = Number(document.getElementById("total-deposit-min").value) || null;
  const total_deposit_max = Number(document.getElementById("total-deposit-max").value) || null;
  const total_rent_min = Number(document.getElementById("total-rent-min").value) || null;
  const total_rent_max = Number(document.getElementById("total-rent-max").value) || null;
  const roi_min = Number(document.getElementById("roi-min").value) || null;
  const roi_max = Number(document.getElementById("roi-max").value) || null;

  if (!name) {
    showToast("고객 이름을 입력해주세요.");
    return;
  }

  let myStaffId = await getMyStaffId();
  if (!myStaffId) {
    showToast("로그인이 필요합니다.");
    return;
  }

  // 매물번호 중복 체크
  highlightDuplicateListingNumbers();
  if (hasDuplicateListingNumbers()) {
    alert("같은 매물번호가 2개 이상 있습니다.\n중복을 먼저 정리한 뒤 다시 저장해주세요.");
    return;
  }

  /* ===========================================================
     🔍 1) 고객이름 + 리스트이름 조합으로 기존 고객 여부 확인
  =========================================================== */
  const { data: existing, error: existErr } = await supabase
    .from("customers")
    .select("*")
    .eq("customer_name", name)
    .eq("list_name", list_name)
    .maybeSingle();

  let customerId = null;

  if (existing) {
    /* ===========================================================
       🔥 2) 기존 조합이 있으면 → confirm 후 전체 덮어쓰기
    =========================================================== */
    const ok = confirm(
      `"${name}" - "${list_name}"가\n이미 존재합니다. 덮어쓸까요?`
    );
    if (!ok) return;

    customerId = existing.id;

    // 고객정보 업데이트
    const { error: updateErr } = await supabase
      .from("customers")
      .update({
        customer_name: name,
        list_name: list_name,
        customer_phone_number: phone,
        grade: grade,
        memo: memo,
        staff_profiles_id: selectedStaffId ?? myStaffId,
        floor_min, floor_max,
        area_min, area_max,
        deposit_min, deposit_max,
        rent_min, rent_max,
        rent_per_py_min, rent_per_py_max,
        premium_min, premium_max,
        sale_min, sale_max,
        total_deposit_min, total_deposit_max,
        total_rent_min, total_rent_max,
        roi_min, roi_max
      })
      .eq("id", customerId);

    if (updateErr) {
      console.error(updateErr);
      showToast("고객 정보 업데이트 중 오류가 발생했습니다.");
      return;
    }

  } else {
    /* ===========================================================
       🆕 3) 기존 조합이 없으면 신규 고객 INSERT
    =========================================================== */
    const { data: inserted, error: insertErr } = await supabase
      .from("customers")
      .insert({
        customer_name: name,
        list_name: list_name,
        customer_phone_number: phone,
        grade: grade,
        memo: memo,
        staff_profiles_id: selectedStaffId ?? myStaffId,
        floor_min, floor_max,
        area_min, area_max,
        deposit_min, deposit_max,
        rent_min, rent_max,
        rent_per_py_min, rent_per_py_max,
        premium_min, premium_max,
        sale_min, sale_max,
        total_deposit_min, total_deposit_max,
        total_rent_min, total_rent_max,
        roi_min, roi_max
      })
      .select()
      .single();

    if (insertErr || !inserted) {
      console.error(insertErr);
      showToast("신규 고객 저장 실패");
      return;
    }

    customerId = inserted.id;
  }

  /* ===========================================================
     🏠 4) 추천매물 전체 덮어쓰기
        (기존 데이터 삭제 → 신규매물 insert)
  =========================================================== */
  currentCustomerId = customerId;

  const saved = await saveListingsForCurrentCustomer();
  if (!saved) {
    showToast("매물 정보 저장 실패");
    return;
  }

  showToast("저장 완료!");

  // 고객 목록 갱신
  loadCustomersForCurrentStaff();
});

// ⭐ 신규 고객 버튼 기능
document.getElementById('new-customer-btn')?.addEventListener('click', () => {
  // 1) 현재 선택 고객 초기화
  currentCustomerId = null;

  // 2) 오른쪽 고객 입력칸 초기화
  document.getElementById('top-row-input').value = '';
  document.getElementById('customer-phone').value = '';
  document.getElementById('list-name-input').value = '리스트';
  document.getElementById('customer-grade').value = 'A';
  document.getElementById('memo-textarea').value = '';

  // 3) 문서 제목 초기화
  setDocumentTitle('');

  // 4) 매물번호 모두 지우기 (원래 있던 이벤트가 알아서 오른쪽 표도 지움)
  document.querySelectorAll('input[data-index]').forEach(inp => {
    inp.value = '';
    inp.dispatchEvent(new Event('change'));
  });

  // 5) 메모 패널 초기화
  renderMemoPanel([]);

  // 6) 담당자 정보 표시
  loadCurrentUserStaffInfo();

  showToast('신규 고객 작성 모드입니다.');
});

// === 숫자열 클릭 시 행 강조 기능 ===
function enableRowHighlight() {
  const tbody = document.getElementById("listings-body");
  if (!tbody) return;
}

// 페이지 로딩 후 기능 활성화
document.addEventListener("DOMContentLoaded", enableRowHighlight);

// === 행 색상 선택 기능 ===
document.addEventListener("DOMContentLoaded", () => {
  const popup = document.getElementById("color-picker-popup");
  let currentRow = null;

  // 팝업 닫기
  document.addEventListener("click", (e) => {
    if (!popup.contains(e.target) && !e.target.classList.contains("color-picker-btn")) {
      popup.classList.add("hidden");
    }
  });

  // 숫자셀 전체 클릭 → 색상 팝업 열기
  document.addEventListener("click", (e) => {
    const td = e.target.closest("td");
    if (!td) return;

    // listings-body 안의 tr인지 확인
    const tr = td.closest("#listings-body tr");
    if (!tr) return;

    // 첫 번째 칸(숫자 셀)인지 확인
    const isFirstCell = [...tr.children].indexOf(td) === 0;
    if (!isFirstCell) return;

    const index = [...tr.parentNode.children].indexOf(tr) + 1;

    // 팝업 위치 = 셀 기준으로 표시
    const rect = td.getBoundingClientRect();
    popup.style.left = rect.left + window.scrollX + "px";
    popup.style.top = rect.bottom + window.scrollY + "px";
    popup.classList.remove("hidden");

    currentRow = tr;
  });

  // 색상 선택 시 행에 적용
  document.querySelectorAll(".color-option").forEach(option => {
    const color = option.dataset.color;
    option.style.backgroundColor = color;
    option.style.border = "1px solid #ccc";
    option.addEventListener("click", () => {
      if (!currentRow) return;

      const color = option.dataset.color;

      // === 취소선 기능 추가 ===
      if (color === "strike") {
        const index = [...currentRow.parentNode.children].indexOf(currentRow) + 1;

        // 🔥 토글 방식: 취소선이 있으면 제거, 없으면 추가
        const alreadyStriked = currentRow.classList.contains("line-through");

        if (alreadyStriked) {
          currentRow.classList.remove("line-through");
          setFieldValue("strike", index, "");      // DB 저장용 hidden input
        } else {
          currentRow.classList.add("line-through");
          setFieldValue("strike", index, "1");   // DB 저장용 hidden input
        }

        popup.classList.add("hidden");
        return;
      }

      // === 기존 색상 해제 처리 ===
      if (color === "none") {
        currentRow.style.backgroundColor = "";
        currentRow.dataset.userColor = "";

        const index = [...currentRow.parentNode.children].indexOf(currentRow) + 1;
        setFieldValue("color", index, "");    // 🔥 색상도 비우기

        popup.classList.add("hidden");
        return;
      }

      // === 기존 색상 선택 로직 ===
      currentRow.dataset.userColor = "true";
      currentRow.classList.remove('bg-white', 'bg-gray-50');
      currentRow.style.backgroundColor = color;

      const index = [...currentRow.parentNode.children].indexOf(currentRow) + 1;
      setFieldValue("color", index, color);

      popup.classList.add("hidden");
    });
  });
});

(function applyColorOptions() {
  const options = document.querySelectorAll(".color-option");
  options.forEach(opt => {
    const color = opt.dataset.color;
    opt.style.setProperty("background-color", color, "important");
  });
})();

// === 색상 선택창의 색상 박스에 배경색 넣기 ===
(function applyColorPreviewColors() {
  const options = document.querySelectorAll(".color-option");
  options.forEach(opt => {
    const color = opt.dataset.color;
    if (color) {
      opt.style.backgroundColor = color;
      opt.style.border = "1px solid #ccc";
    }
  });
})();