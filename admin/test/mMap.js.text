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
        center: new kakao.maps.LatLng(37.5665, 126.9780),
        level: 3
    });

    // 지도가 이동하거나 줌 변경될 때마다 마커 다시 로드
    kakao.maps.event.addListener(map, "idle", reloadListingsOnMapThrottled);

    // 📌 클러스터러 반드시 여기서 초기화해야 함
    clusterer = new kakao.maps.MarkerClusterer({
        map: map,
        averageCenter: true,
        minLevel: 5,
        disableClickZoom: false
    });

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                map.setCenter(new kakao.maps.LatLng(lat, lng));
            },
            (err) => {
                console.log("위치 정보를 가져올 수 없음", err);
            }
        );
    }

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

    if (level >= 4) {
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
            category
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
            status.includes("완료") ? "🔹" :
            status.includes("보류") ? "◆" :
            "🔸";

        html += `
            <div style="padding:4px 0; font-size:13px;">
                ${icon} <strong>${item.listing_id}</strong> ${item.listing_title || "-"}<br/>
                <strong>${floor}층</strong>
                <strong>${formatNumber(item.deposit_price)}</strong> /
                <strong>${formatNumber(item.monthly_rent)}</strong>
                ${
                    (!item.premium_price || Number(item.premium_price) === 0)
                        ? "무권리"
                        : `권<strong>${formatNumber(item.premium_price)}</strong>`
                }
                <strong>${item.area_py != null ? Number(item.area_py).toFixed(1) : "-"}</strong>평
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
document.getElementById("filter-reset-btn").addEventListener("click", resetFilterSelections);

// 🎯 통합 필터 토글 버튼
window.addEventListener("DOMContentLoaded", () => {
    const filterBtn = document.getElementById("filter-btn");
    const filterBox = document.getElementById("filter-box-merged");

    if (filterBtn && filterBox) {
        filterBtn.addEventListener("click", () => {
            filterBox.style.display =
                filterBox.style.display === "none" ? "block" : "none";
        });
    }
});

// 🎯 필터창 외 클릭하면 닫기
window.addEventListener("click", (e) => {
    const filterBtn = document.getElementById("filter-btn");
    const filterBox = document.getElementById("filter-box-merged");

    if (!filterBtn || !filterBox) return;

    if (
        e.target !== filterBtn &&
        !filterBtn.contains(e.target) &&
        !filterBox.contains(e.target)
    ) {
        filterBox.style.display = "none";
    }
});
