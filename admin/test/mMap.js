import {
    numericFilters,
    getSelectedStatuses,
    getSelectedDealTypes,
    getSelectedCategories,
    getNumericFilterRange,
    applyNumericFilters,
    applyAllFilters,
    attachFilterInputEvents
} from "./filter.js";

let map;
let clusterer = null;
let allMarkers = [];
let desktopInfoWindow = null;

window.addEventListener("DOMContentLoaded", () => {
    map = new kakao.maps.Map(document.getElementById("map"), {
        center: new kakao.maps.LatLng(37.728761, 126.734986),
        level: 4
    });

    // 지도가 이동하거나 줌 변경될 때마다 마커 다시 로드
    kakao.maps.event.addListener(map, "idle", reloadListingsOnMapThrottled);

    // 📌 클러스터러 반드시 여기서 초기화해야 함
    clusterer = new kakao.maps.MarkerClusterer({
        map: map,
        averageCenter: true,
        minLevel: 3,
        disableClickZoom: false
    });

    kakao.maps.event.addListener(map, "click", () => {
        const panel = document.getElementById("side-panel");
        panel.style.display = "none";

        // PC 모드일 때 InfoWindow 닫기
        if (desktopInfoWindow) {
            desktopInfoWindow.close();
        }
    });

    // 🔔 지도 확대 안내 문구 UI 생성
    const zoomNotice = document.createElement("div");
    zoomNotice.id = "zoom-notice";
    zoomNotice.style.position = "fixed";
    const headerHeight = document.querySelector("header").offsetHeight;
    zoomNotice.style.top = (headerHeight + 10) + "px";  // 헤더 바로 아래 10px 여백
    zoomNotice.style.right = "20px";
    zoomNotice.style.zIndex = "9999";
    zoomNotice.style.background = "rgba(0,0,0,0.7)";
    zoomNotice.style.color = "#fff";
    zoomNotice.style.padding = "8px 12px";
    zoomNotice.style.borderRadius = "8px";
    zoomNotice.style.fontSize = "14px";
    zoomNotice.style.display = "none"; // 기본 숨김
    zoomNotice.innerText = "지도를 확대하세요";
    document.body.appendChild(zoomNotice);

    // 🔥 페이지 첫 로드 시 필터 초기화 실행
    resetFilterSelections();

    // 📌 현재 위치 버튼 기능
    const currentBtn = document.getElementById("btn-current-location");
    if (currentBtn) {
        currentBtn.addEventListener("click", () => {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        const lat = pos.coords.latitude;
                        const lng = pos.coords.longitude;

                        const moveLatLng = new kakao.maps.LatLng(lat, lng);
                        map.panTo(moveLatLng);
                    },
                    (err) => {
                        alert("현재 위치를 가져올 수 없습니다.");
                        console.error(err);
                    }
                );
            } else {
                alert("이 브라우저는 위치 정보를 지원하지 않습니다.");
            }
        });
    }

});

async function searchListingsByTitle(keyword) {
    if (!keyword) return [];

    const { data, error } = await window.supabase
        .from("baikukdbtest")
        .select(`
            listing_id,
            listing_title,
            deposit_price,
            monthly_rent,
            premium_price,
            area_py,
            floor,
            transaction_status
        `)
        .ilike("listing_title", `%${keyword}%`)
        .limit(50);

    if (error) {
        console.error("❌ 제목 검색 오류:", error);
        return [];
    }
    return data;
}

function renderSearchResults(list) {
    const box = document.getElementById("search-result-box");
    if (!box) return;

    if (!list.length) {
        box.innerHTML = "<div style='padding:6px;'>검색 결과가 없습니다.</div>";
        box.style.display = "block";
        return;
    }

    box.innerHTML = list
        .map(item => `
            <div class="search-item"
                 data-id="${item.listing_id}"
                 style="padding:6px; border-bottom:1px solid #eee; cursor:pointer;">
                 
                <strong>${item.listing_title}</strong><br/>
                ${item.floor ?? "-"}층 /
                ${item.area_py ?? "-"}평 /
                보 ${item.deposit_price ?? "-"} /
                월 ${item.monthly_rent ?? "-"}
            </div>
        `)
        .join("");

    box.style.display = "block";
}

function clearAllMarkers() {
    allMarkers.forEach(m => {
        if (m.marker) m.marker.setMap(null);
    });
    clusterer.clear();
    allMarkers = [];
}

function onFilterChanged() {
    clearAllMarkers();
    reloadListingsOnMapThrottled();
}

function enforceZoomLevelBehavior() {
    const level = map.getLevel();
    const notice = document.getElementById("zoom-notice");

    if (level >= 5) {
        // 문구 표시
        notice.style.display = "block";

        // 마커 숨기기
        allMarkers.forEach(m => {
            if (m.marker) m.marker.setMap(null);
        });

        // 클러스터러에서도 제거
        clusterer.clear();

        return false;  // 데이터 로딩 금지 신호
    } else {
        notice.style.display = "none";
        return true;   // 데이터 로딩 허용
    }
}

function formatNumber(num) {
    if (num === null || num === undefined || num === "-" || num === "") return "-";
    const n = Number(num);
    if (isNaN(n)) return num;
    return n.toLocaleString("ko-KR");
}

async function loadListingsByAddress(fullAddress) {
    const { data, error } = await window.supabase
        .from("baikukdbtest")
        .select(`
            listing_id,
            listing_title,
            deposit_price,
            monthly_rent,
            premium_price,
            area_py,
            floor,
            transaction_status,
            deal_type,
            category,
            rent_per_py
        `)
        .eq("full_address", fullAddress);

    if (error) {
        console.error("❌ 매물 상세 조회 오류:", error);
        return [];
    }
    return data;
}

// =============================
// 🔥 현재 지도 범위보다 조금 넓게 Supabase 조회
// =============================

// 🔥 실제 보이는 지도 영역(Bounds)을 반환하는 함수
function getVisibleBounds() {
    const bounds = map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    return {
        minLat: sw.getLat(),
        maxLat: ne.getLat(),
        minLng: sw.getLng(),
        maxLng: ne.getLng()
    };
}

// 🔥 지도의 실제 보이는 영역(Bounds)에 포함되는 매물만 조회
async function loadListingsByBounds() {
    const b = getVisibleBounds();
    const selectedStatuses = getSelectedStatuses();
    const selectedDealTypes = getSelectedDealTypes();

    // 기본 쿼리
    let query = window.supabase
        .from("baikukdbtest")
        .select(`
            full_address,
            lat,
            lng,
            transaction_status,
            deal_type,
            category
        `)
        .gte("lat", b.minLat).lte("lat", b.maxLat)
        .gte("lng", b.minLng).lte("lng", b.maxLng);

    // 🔥 OR 필터 전체 결합
    let orFilters = [];

    // 카테고리 필터 (상가/빌딩/공장/주택)
    const selectedCategories = getSelectedCategories();
    if (selectedCategories.length > 0) {
        orFilters.push(
            ...selectedCategories.map(c => `category.ilike.%${c}%`)
        );
    }

    // 거래상태
    if (selectedStatuses.length > 0) {
        orFilters.push(
            ...selectedStatuses.map(s => `transaction_status.ilike.%${s}%`)
        );
    }

    // 거래유형 (월세/매매)
    if (selectedDealTypes.length > 0) {
        orFilters.push(
            ...selectedDealTypes.map(t => `deal_type.ilike.%${t}%`)
        );
    }

    // 조건이 하나라도 있으면 OR 로 연결
    if (orFilters.length > 0) {
        query = query.or(orFilters.join(","));
    }

    // 최종 Supabase 실행
    const { data, error } = await query;

    if (error) {
        console.error("❌ Bound Supabase 조회 오류:", error);
        return [];
    }

    return data;
}


function renderListingWithFloorSeparator(listings) {
    let prevFloor = null;
    let html = "";

    listings.forEach(item => {
        const floor = item.floor ?? "-";

        // 층이 바뀌면 구분선 추가
        if (prevFloor !== null && prevFloor !== floor) {
            html += `<div style="border-top:1px solid #ddd; margin:6px 0;"></div>`;
        }

        prevFloor = floor;

        const status = item.transaction_status || "";
        const icon =
            status.includes("완료") ? "◆" :
            status.includes("보류") ? "🔹" :
            "🔸";

        // ==============================
        // 🔥 상태별 배경색 지정
        // ==============================
        let bgColor = "";
        if (status.includes("완료")) {
            bgColor = "background:#f0f0f0;";
        } else if (status.includes("보류")) {
            bgColor = "background:#FFE5E5;";
        } else {
            bgColor = "background:#F7DA79;";
        }

        // ==============================
        // 🔥 최종 HTML 출력
        // ==============================
        html += `
            <div class="listing-item" data-id="${item.listing_id}" style="padding:4px 0; font-size:14px; cursor:pointer; ${bgColor}">
                ${icon} 
                <strong>
                    <span class="copy-listing-id"
                        data-id="${item.listing_id}"
                        style="cursor:pointer;"
                        onclick="event.stopPropagation();">
                        ${item.listing_id}
                    </span>
                </strong>
                <strong><span style="font-size:15px;">${item.listing_title || "-"}</span></strong><br/>
                <strong><span style="display:inline-block; min-width:30px; text-align:right;">${floor}층</span></strong> /
                <span style="display:inline-block; min-width:50px; text-align:right;"><strong>${item.area_py != null ? Number(item.area_py).toFixed(1) : "-"}</strong>평</span> /
                <strong><span style="color:blue; min-width:70px; text-align:right;">보 </span>${formatNumber(item.deposit_price)}</strong> /
                <strong><span style="color:green; min-width:60px; text-align:right;">월 </span>${formatNumber(item.monthly_rent)}</strong> /
                ${
                    (!item.premium_price || Number(item.premium_price) === 0)
                        ? `<strong><span style="color:red; min-width:85px; text-align:right;">무권리</span></strong> /`
                        : `<span style="min-width:85px; text-align:right;"><strong><span style="color:red;">권 </span></strong> <strong>${formatNumber(item.premium_price)}</strong></span> /`
                }
                ${
                    item.rent_per_py
                        ? `<strong>${Number(item.rent_per_py).toFixed(1)}만</strong>`
                        : ""
                }
            </div>
        `;
    });

    return html;
}

async function renderListingsOnMap() {
    let listings = await loadListingsByBounds();

    // 🔥 JS단 추가 필터링 (층)
    listings = applyAllFilters(listings);

    // 🔥 필터 결과가 0건이면 기존 마커 전부 제거하고 종료
    if (!listings.length) {
        allMarkers.forEach(m => {
            if (m.marker) m.marker.setMap(null);
        });
        clusterer.clear();
        allMarkers = [];
        return;
    }

    const nextMap = new Map();   // full_address 기준
    listings.forEach(i => {
        nextMap.set(i.full_address, i);
    });

    const currentMap = new Map();
    allMarkers.forEach(m => {
        currentMap.set(m.full_address, m);
    });

    // 1) 삭제해야 할 마커 찾기
    currentMap.forEach((markerObj, addr) => {
        if (!nextMap.has(addr)) {
            markerObj.marker.setMap(null);
            clusterer.removeMarker(markerObj.marker);
            currentMap.delete(addr);
        }
    });

    // 2) 새로 추가할 마커 추가 (⚡ 주소 기준으로 필터 통과 매물 없으면 마커 미생성)
    nextMap.forEach((item, addr) => {
        if (!currentMap.has(addr)) {

            // 👉 해당 주소의 실제 매물들을 조회
            loadListingsByAddress(addr).then(listingsAtAddr => {

                // 층 필터
                listingsAtAddr = applyAllFilters(listingsAtAddr);

                // 👉 필터링 후 매물이 한 건도 없다면 이 주소는 마커를 만들지 않음!!
                if (listingsAtAddr.length === 0) return;

                // 👉 여기서 마커 생성
                const marker = new kakao.maps.Marker({
                    position: new kakao.maps.LatLng(item.lat, item.lng)
                });

                clusterer.addMarker(marker);

                currentMap.set(addr, {
                    full_address: addr,
                    marker: marker
                });

                // 👉 마커 클릭 이벤트 (기존 그대로)
                kakao.maps.event.addListener(marker, "click", async () => {
                    const isPC = window.innerWidth >= 769;

                    let listings = await loadListingsByAddress(addr);
                    listings = applyAllFilters(listings);
                    listings.sort((a,b)=> (a.floor ?? 0) - (b.floor ?? 0));

                    // =================================
                    // 📌 PC — InfoWindow 사용 (끝)
                    // =================================
                    if (isPC) {

                        // 기존 infoWindow 닫기
                        if (desktopInfoWindow) {
                            desktopInfoWindow.close();
                        }

                        const contentHTML = listings.length
                            ? renderListingWithFloorSeparator(listings)
                            : "<div style='font-size:13px;'>조건에 맞는 매물이 없습니다.</div>";

                        desktopInfoWindow = new kakao.maps.InfoWindow({
                            position: marker.getPosition(),
                            content: `
                                <div style="
                                    background:#fff;
                                    padding:10px;
                                    border:1px solid #ccc;
                                    border-radius:8px;
                                    max-height:60vh;
                                    overflow-y:auto;
                                    font-size:13px;
                                    white-space:nowrap;
                                ">
                                    ${contentHTML}
                                </div>
                            `
                        });

                        desktopInfoWindow.open(map, marker);
                        // 🔥 InfoWindow 내부 클릭 이벤트 연결
                        setTimeout(() => {
                            // 목록 클릭 → 상세페이지 이동
                            document.querySelectorAll('.listing-item').forEach(el => {
                                el.addEventListener('click', (e) => {
                                    if (e.target.closest('.copy-listing-id')) return;
                                    const id = el.dataset.id;
                                    openListingNewTab(id);
                                });
                            });

                            // 🔥 InfoWindow 내부의 복사 이벤트 바인딩
                            document.querySelectorAll('.copy-listing-id').forEach(span => {
                                span.addEventListener('click', (e) => {
                                    e.stopPropagation();   // 부모 이동 막기

                                    const id = span.dataset.id;

                                    navigator.clipboard.writeText(id)
                                        .then(() => {
                                            showToast(`${id} 복사완료`);
                                        })
                                        .catch(err => console.error(err));
                                });
                            });

                        }, 50);

                        return;
                    }

                    // =================================
                    // 📌 모바일 — 기존 side-panel 그대로 유지
                    // =================================
                    const panel = document.getElementById("side-panel");
                    panel.innerHTML = listings.length
                        ? renderListingWithFloorSeparator(listings)
                        : "<div>조건에 맞는 매물이 없습니다.</div>";

                    panel.style.left = "10px";
                    panel.style.top = "calc(var(--header-height) + 10px)";
                    panel.style.display = "block";

                    // 🔥 모바일에서도 클릭 이벤트 바인딩
                    setTimeout(() => {
                        // 매물 클릭 → 상세페이지 이동
                        document.querySelectorAll('#side-panel .listing-item').forEach(el => {
                            el.addEventListener('click', (e) => {
                                if (e.target.closest('.copy-listing-id')) return;
                                const id = el.dataset.id;
                                openListingNewTab(id);
                            });
                        });

                        // 매물번호 클릭 → 복사
                        document.querySelectorAll('#side-panel .copy-listing-id').forEach(span => {
                            span.addEventListener('click', (e) => {
                                e.stopPropagation();
                                const id = span.dataset.id;

                                navigator.clipboard.writeText(id)
                                    .then(() => showToast(`${id} 복사완료`))
                                    .catch(err => console.error(err));
                            });
                        });
                    }, 50);

                });

            });
        }
    });

    // 업데이트된 마커 목록 저장
    allMarkers = Array.from(currentMap.values());
}

// 지도 로딩 후 실행
window.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
        if (enforceZoomLevelBehavior()) {
            renderListingsOnMap();
        }
    }, 800);
});

window.addEventListener("DOMContentLoaded", () => {
    attachFilterInputEvents(onFilterChanged);
});

// =============================
// 🔥 지도 이동/확대/축소 시 자동 reload
// =============================

let reloadTimer = null;

function reloadListingsOnMapThrottled() {
    if (reloadTimer) clearTimeout(reloadTimer);

    reloadTimer = setTimeout(() => {
        // 줌 레벨 제한 체크
        if (!enforceZoomLevelBehavior()) return;

        // 정상일 때만 데이터 로드
        renderListingsOnMap();
    }, 400);
}

// 필터 초기화 함수
function resetFilterSelections() {
    // 전체 체크박스 false
    document.querySelectorAll(".status-check, .dealtype-check, .category-check")
        .forEach(cb => cb.checked = false);

    // 기본 선택값 적용
    const defaults = ["진행중", "월세", "상가", "빌딩", "공장"];
    defaults.forEach(val => {
        document.querySelectorAll("input[type='checkbox']").forEach(cb => {
            if (cb.value.includes(val)) cb.checked = true;
        });
    });

    // 숫자 필터 초기화
    Object.keys(numericFilters).forEach(key => {
        const min = document.getElementById(`${key}-min`);
        const max = document.getElementById(`${key}-max`);
        if (min) min.value = "";
        if (max) max.value = "";
    });

    // 지도 reload
    reloadListingsOnMapThrottled();
}

// 🔥 초기화 버튼 클릭 시 함수 실행
document.getElementById("filter-reset-btn").addEventListener("click", () => {
    resetFilterSelections();     // 필터 모두 초기화
    updateCustomerButtonLabel(""); 
    clearAllMarkers();           
    reloadListingsOnMapThrottled();
});

// 🎯 통합 필터 토글 버튼
window.addEventListener("DOMContentLoaded", () => {
    const filterBtn = document.getElementById("filter-btn");
    const filterBox = document.getElementById("filter-box-merged");

    if (filterBtn && filterBox) {
        filterBtn.addEventListener("click", () => {
            const isHidden = filterBox.style.display === "none";

            // 토글
            filterBox.style.display = isHidden ? "block" : "none";

            // 🔥 필터창을 항상 화면 좌측 상단 고정 위치로 설정
            if (isHidden) {
                filterBox.style.position = "fixed";
                filterBox.style.top = "calc(var(--header-height) + 10px)";
                filterBox.style.left = "10px";
                filterBox.style.zIndex = "99999";
            }
        });
    }
});

// 🔥 필터창 외 클릭하면 닫기 (왼쪽 고정 버전)
window.addEventListener("click", (e) => {
    const filterBtn = document.getElementById("filter-btn");
    const filterBox = document.getElementById("filter-box-merged");

    if (!filterBtn || !filterBox) return;

    const clickedInside =
        filterBox.contains(e.target) || filterBtn.contains(e.target);

    if (!clickedInside) {
        filterBox.style.display = "none";
    }
});

// =====================================================================================
// 🔥 고객창: 필터창처럼 바깥 클릭 시 닫기
// =====================================================================================
window.addEventListener("click", (e) => {
    const customerPanel = document.getElementById("customer-panel");
    const customerBtn = document.getElementById("toggle-customer-panel");

    // panel, button 둘 중 하나라도 클릭하면 닫지 않음
    if (
        customerPanel.contains(e.target) ||
        customerBtn.contains(e.target)
    ) return;

    // 클릭한 위치가 panel 밖이면 닫기
    customerPanel.style.display = "none";
});

// =====================================================================================
// 🔥 Supabase에서 고객 리스트 불러오기
// =====================================================================================

// 로그인한 직원의 staff_profiles.id 가져오기
async function getCurrentStaffProfileId() {
    const { data: { session } } = await window.supabase.auth.getSession();
    if (!session) return null;

    // supabase auth user.id
    const userId = session.user.id;

    const { data, error } = await window.supabase
        .from("staff_profiles")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();

    if (error || !data) {
        console.error("❌ staff_profiles 조회 실패:", error);
        return null;
    }

    return data.id;  // staff_profiles.id
}

// =====================================================================================
// 🔥 로그인한 계정의 고객만 불러오기
// =====================================================================================
async function loadCustomers() {

    const staffId = await getCurrentStaffProfileId();
    if (!staffId) {
        console.warn("직원 프로필을 찾을 수 없음");
        return [];
    }

    const { data, error } = await window.supabase
        .from("customers")
        .select(`
            id,
            customer_name,
            customer_phone_number,
            memo,
            grade,
            registered_at,
            staff_profiles_id
        `)
        .eq("staff_profiles_id", staffId)        // ← 로그인한 직원의 고객만!
        .order("registered_at", { ascending: false });

    if (error) {
        console.error("❌ 고객 리스트 로드 오류:", error);
        return [];
    }

    return data;
}

function renderCustomerList(customers) {
    if (!customers.length) {
        return "<div class='text-sm'>등록된 고객이 없습니다.</div>";
    }

    // 등급 정렬 우선순위
    const gradeOrder = {
        "계약": 0, "A": 1, "B": 2, "C": 3, "D": 4, "E": 5, "F": 6
    };

    // 등급별 정렬
    customers.sort((a, b) => {
        const aRank = gradeOrder[a.grade] ?? 999;
        const bRank = gradeOrder[b.grade] ?? 999;
        return aRank - bRank;
    });

    // 등급별 그룹핑
    const grouped = customers.reduce((acc, c) => {
        const g = c.grade || "기타";
        if (!acc[g]) acc[g] = [];
        acc[g].push(c);
        return acc;
    }, {});

    let html = "";

    Object.keys(gradeOrder).forEach(grade => {
        if (!grouped[grade]) return;

        const list = grouped[grade];

        html += `
            <div class="grade-wrapper border-b pb-2">
                <div class="grade-header flex justify-between items-center py-2 cursor-pointer font-bold text-base"
                     data-grade="${grade}">
                    <span>${grade} (${list.length})</span>
                    <span class="toggle-icon">▼</span>
                </div>
                <div class="grade-content pl-2" id="grade-${grade}" style="display:none;">
                    ${list
                        .map(c => `
                            <div class="customer-item py-1 text-sm border-b cursor-pointer"
                                data-id="${c.id}">
                                ${c.customer_name}
                            </div>
                        `)
                        .join("")}
                </div>
            </div>
        `;
    });

    return html;
}

// =====================================================================================
// 🔥 고객 리스트 패널 열기 / 닫기 (필터창과 동일 UI로 동작)
// =====================================================================================
window.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("toggle-customer-panel");
    const panel = document.getElementById("customer-panel");
    const filterBox = document.getElementById("filter-box-merged");

    if (btn && panel) {
        btn.addEventListener("click", async () => {

            const isHidden = panel.style.display === "none";

            // 🔥 패널 열기
            if (isHidden) {
                // 고객 데이터 로드
                const customers = await loadCustomers();
                panel.innerHTML = renderCustomerList(customers);

                // 필터창 닫기 (겹침 방지)
                if (filterBox) filterBox.style.display = "none";

                // filter-box-merged 와 완전히 동일한 위치로 고정
                panel.style.position = "fixed";
                panel.style.top = "calc(var(--header-height) + 10px)";
                panel.style.left = "10px";
                panel.style.zIndex = "99999";
                panel.style.display = "block";
            } 
            // 🔥 패널 닫기
            else {
                panel.style.display = "none";
            }
        });
    }
});

// =====================================================================================
// 🔥 고객패널 아코디언 기능 (등급 접기/펼치기)
// =====================================================================================
document.addEventListener("click", (e) => {
    const header = e.target.closest(".grade-header");
    if (!header) return;

    const grade = header.dataset.grade;
    const content = document.getElementById(`grade-${grade}`);
    const icon = header.querySelector(".toggle-icon");

    if (!content) return;

    const isHidden = content.style.display === "none";
    content.style.display = isHidden ? "block" : "none";
    icon.textContent = isHidden ? "▲" : "▼";
});

// =====================================================================================
// 🔥 고객 1명 클릭 → 필터 적용 + 고객 이름 표시
// =====================================================================================
document.addEventListener("click", async (e) => {
    const item = e.target.closest(".customer-item");
    if (!item) return;

    const customerId = item.dataset.id;
    if (!customerId) return;

    const customerName = item.textContent.trim();

    // 고객 패널 닫기
    document.getElementById("customer-panel").style.display = "none";

    // 고객 이름 라벨 표시
    updateCustomerButtonLabel(customerName);

    // 고객 필터 적용
    await loadCustomerFilter(customerId);
});

// =====================================================================================
// 🔥 특정 고객의 필터(조건) 불러오기 — 숫자 필터는 고객값, 체크박스는 초기화 상태로!
// =====================================================================================
async function loadCustomerFilter(customerId) {

    const { data, error } = await window.supabase
        .from("customers")
        .select("*")
        .eq("id", customerId)
        .maybeSingle();

    if (error || !data) {
        console.error("❌ 고객 필터 조회 실패:", error);
        return;
    }

    // -----------------------------------------
    // 1) 숫자 필터 매핑 테이블
    // -----------------------------------------
    const numericMap = {
        floor: ["floor_min", "floor_max"],
        area: ["area_min", "area_max"],
        deposit: ["deposit_min", "deposit_max"],
        rent: ["rent_min", "rent_max"],
        rent_per_py: ["rent_per_py_min", "rent_per_py_max"],
        premium: ["premium_min", "premium_max"],
        sale: ["sale_min", "sale_max"],
        "total-deposit": ["total_deposit_min", "total_deposit_max"],
        "total-rent": ["total_rent_min", "total_rent_max"],
        roi: ["roi_min", "roi_max"]
    };

    // -----------------------------------------
    // 2) 숫자 필터 input 에 값 채우기
    // -----------------------------------------
    for (const key in numericMap) {
        const [minKey, maxKey] = numericMap[key];

        const minInput = document.getElementById(`${key}-min`);
        const maxInput = document.getElementById(`${key}-max`);

        if (minInput) minInput.value = data[minKey] ?? "";
        if (maxInput) maxInput.value = data[maxKey] ?? "";
    }

    // -----------------------------------------
    // 3) 체크박스 필터는 “초기화 버튼과 동일하게 설정”
    // -----------------------------------------

    // 전체 체크 해제
    document.querySelectorAll(".status-check, .dealtype-check, .category-check")
        .forEach(cb => cb.checked = false);

    // 초기화 버튼의 기본 체크값과 동일하게 적용
    const defaults = ["진행중", "월세", "상가", "빌딩", "공장"];
    defaults.forEach(val => {
        document.querySelectorAll("input[type='checkbox']").forEach(cb => {
            if (cb.value.includes(val)) cb.checked = true;
        });
    });

    // -----------------------------------------
    // 4) 🔥 모든 필터 설정 후 지도에 적용
    // -----------------------------------------
    onFilterChanged();
}

// =====================================================================================
// 🔥 고객 선택될 때 "👤 고객 리스트" 버튼에 고객 이름 표시
// =====================================================================================
function updateCustomerButtonLabel(name) {
    const btn = document.getElementById("toggle-customer-panel");
    if (!btn) return;

    if (!name) {
        btn.textContent = "👤 고객 리스트";
    } else {
        btn.textContent = `👤 ${name}`;
    }
}

function showToast(message) {
    let toast = document.getElementById("copy-toast");

    if (!toast) {
        toast = document.createElement("div");
        toast.id = "copy-toast";
        toast.style.position = "fixed";
        toast.style.top = "33px";                
        toast.style.left = "50%";               
        toast.style.transform = "translate(-50%, -50%)";
        toast.style.background = "#F2C130";          // 🔥 완전 불투명 배경
        toast.style.color = "#000";                  // 🔥 글씨 색 검정
        toast.style.padding = "12px 20px";
        toast.style.borderRadius = "8px";
        toast.style.fontSize = "15px";
        toast.style.fontWeight = "bold"; 
        toast.style.zIndex = "999999";
        toast.style.opacity = "0";                   // ← 애니메이션용 (배경 투명 X)
        toast.style.transition = "opacity 0.35s ease";
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.opacity = "1";

    setTimeout(() => {
        toast.style.opacity = "0";
    }, 3000);
}

function openListingNewTab(listingId) {
    const url = `https://baikuk.com/item/view/${listingId}`;
    window.open(url, "_blank");
}

// 검색기능 관련 함수

document.addEventListener("DOMContentLoaded", () => {
    const input = document.getElementById("search-title-input");
    const resultBox = document.getElementById("search-result-box");

    if (!input || !resultBox) return;

    let typingTimer = null;

    input.addEventListener("input", () => {
        const keyword = input.value.trim();

        if (!keyword) {
            resultBox.style.display = "none";
            return;
        }

        // 입력 디바운싱 (검색 과부하 방지)
        if (typingTimer) clearTimeout(typingTimer);

        typingTimer = setTimeout(async () => {
            const list = await searchListingsByTitle(keyword);
            renderSearchResults(list);
        }, 200);
    });
});

document.addEventListener("click", (e) => {
    const item = e.target.closest(".search-item");
    if (!item) return;

    const id = item.dataset.id;
    const url = `https://baikuk.com/item/view/${id}`;
    window.open(url, "_blank");
});
