// ▷ 기본 지도 초기화 코드

let map;
let currentInfoWindow = null;
let clusterer = null;
let allMarkers = [];

window.addEventListener("DOMContentLoaded", () => {
    map = new kakao.maps.Map(document.getElementById("map"), {
        center: new kakao.maps.LatLng(37.5665, 126.9780),
        level: 3
    });

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
    });

    kakao.maps.event.addListener(map, "idle", reloadListingsOnMapThrottled);

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
});

function getSelectedStatuses() {
    return Array.from(document.querySelectorAll(".status-check:checked"))
        .map(cb => cb.value);
}

function getSelectedDealTypes() {
    return Array.from(document.querySelectorAll(".dealtype-check:checked"))
        .map(cb => cb.value);
}

function getSelectedCategories() {
    return Array.from(document.querySelectorAll(".category-check:checked"))
        .map(cb => cb.value);
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

async function renderListingsOnMap() {
    let listings = await loadListingsByBounds();

    // 🔥 JS단 추가 필터링 (deal_type)
    const selectedDealTypes = getSelectedDealTypes();
    if (selectedDealTypes.length > 0) {
        listings = listings.filter(i => {
            const dt = i.deal_type || "";
            return selectedDealTypes.some(sel => dt.includes(sel));
        });
    }

    // 🔥 JS단 추가 필터링 (category)
    const selectedCategories = getSelectedCategories();
    if (selectedCategories.length > 0) {
        listings = listings.filter(i => {
            const ct = i.category || "";
            return selectedCategories.some(sel => ct.includes(sel));
        });
    }

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

                // 상태 필터
                const selectedStatuses = getSelectedStatuses();
                if (selectedStatuses.length > 0) {
                    listingsAtAddr = listingsAtAddr.filter(i =>
                        selectedStatuses.some(s => (i.transaction_status || "").includes(s))
                    );
                }

                // 거래유형 필터
                const selectedDealTypes = getSelectedDealTypes();
                if (selectedDealTypes.length > 0) {
                    listingsAtAddr = listingsAtAddr.filter(i =>
                        selectedDealTypes.some(t => (i.deal_type || "").includes(t))
                    );
                }

                // 카테고리 필터
                const selectedCategories = getSelectedCategories();
                if (selectedCategories.length > 0) {
                    listingsAtAddr = listingsAtAddr.filter(i =>
                        selectedCategories.some(c => (i.category || "").includes(c))
                    );
                }

                // 👉 필터링 후 매물이 한 건도 없다면 이 주소는 마커를 만들지 않음!!
                if (listingsAtAddr.length === 0) return;

                // 👉 여기서 마커 생성
                const marker = new kakao.maps.Marker({
                    position: new kakao.maps.LatLng(item.lat, item.lng)
                });

                // 🔥 자동 InfoWindow: 확대 레벨 2 이하 + 매물 1건일 때
                if (map.getLevel() <= 2 && listingsAtAddr.length === 1) {

                    const only = listingsAtAddr[0];

                    // ❗ 중요: 자동 InfoWindow는 다른 마커 눌러도 닫히지 않아야 하므로
                    // currentInfoWindow.close() 같은 코드는 절대 넣지 않는다.

                    const iwContent = `
                        <div style="padding:6px 10px; font-size:13px;">
                            <strong>${only.listing_title || "-"}</strong><br/>
                            <span>${only.floor ?? "-"}층</span>
                            <span>${formatNumber(only.deposit_price)}</span> /
                            <span>${formatNumber(only.monthly_rent)}</span>
                            ${
                                (only.premium_price == null || Number(only.premium_price) === 0)
                                    ? "무권리"
                                    : `권 ${formatNumber(only.premium_price)}`
                            }
                        </div>
                    `;

                    const infoWindow = new kakao.maps.InfoWindow({
                        position: new kakao.maps.LatLng(item.lat, item.lng),
                        content: iwContent,
                        removable: true // X 버튼으로만 닫힘
                    });

                    infoWindow.open(map, marker);
                    // ❗ 자동 InfoWindow는 currentInfoWindow 로 저장하지 않음
                }

                clusterer.addMarker(marker);

                currentMap.set(addr, {
                    full_address: addr,
                    marker: marker
                });

                // 👉 마커 클릭 이벤트 (기존 그대로)
                kakao.maps.event.addListener(marker, "click", async () => {

                    // ❗ 클릭하여 여는 InfoWindow는 기존 것 닫기
                    if (currentInfoWindow) currentInfoWindow.close();

                    let listings = await loadListingsByAddress(addr);

                    const selectedStatuses = getSelectedStatuses();
                    if (selectedStatuses.length > 0) {
                        listings = listings.filter(i =>
                            selectedStatuses.some(s => (i.transaction_status || "").includes(s))
                        );
                    }

                    const selectedDealTypes = getSelectedDealTypes();
                    if (selectedDealTypes.length > 0) {
                        listings = listings.filter(i =>
                            selectedDealTypes.some(t => (i.deal_type || "").includes(t))
                        );
                    }

                    const selectedCategories = getSelectedCategories();
                    if (selectedCategories.length > 0) {
                        listings = listings.filter(i =>
                            selectedCategories.some(c => (i.category || "").includes(c))
                        );
                    }

                    listings.sort((a, b) => (a.floor ?? 0) - (b.floor ?? 0));

                    const panel = document.getElementById("side-panel");
                    panel.innerHTML = listings.length
                        ? listings.map(i => {
                            const status = i.transaction_status || "";

                            // 상태에 따른 아이콘
                            const icon =
                                status.includes("완료") ? "🔹" :
                                status.includes("보류") ? "◆" :
                                "🔸";

                            const textColor = (() => {
                                if (status.includes("완료")) return "red";
                                if (status.includes("보류")) return "green";
                                if (status.includes("진행")) return "black";
                                return "black";
                            })();

                            return `
                                <div style="margin-bottom:6px; color:${textColor} !important;">
                                    ${icon} <strong>${i.listing_id}</strong> ${i.listing_title || "-"}<br/>
                                    <strong>${i.floor != null ? i.floor + "층" : "-"}</strong>
                                    <strong>${formatNumber(i.deposit_price)}</strong> /
                                    <strong>${formatNumber(i.monthly_rent)}</strong>
                                    ${
                                        (i.premium_price == null || Number(i.premium_price) === 0)
                                            ? "무권리"
                                            : `권<strong>${formatNumber(i.premium_price)}</strong>`
                                    }
                                    <strong>${i.area_py != null ? Number(i.area_py).toFixed(1) : "-"}</strong>평
                                </div>
                            `;
                        }).join("")
                        : "<div>조건에 맞는 매물이 없습니다.</div>";

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

// 🔥 필터 박스 토글 기능 (버튼 클릭 → 열기/닫기)
window.addEventListener("DOMContentLoaded", () => {
    const toggleBtn = document.getElementById("filter-toggle-btn");
    const filterBox = document.getElementById("filter-box");

    if (toggleBtn && filterBox) {
        toggleBtn.addEventListener("click", () => {
            filterBox.style.display =
                filterBox.style.display === "none" ? "block" : "none";
        });
    }
});

// 🔥 필터 박스 영역 외 클릭 시 자동 닫기
window.addEventListener("click", (e) => {
    const toggleBtn = document.getElementById("filter-toggle-btn");
    const filterBox = document.getElementById("filter-box");

    if (!toggleBtn || !filterBox) return;

    // 클릭한 대상이 버튼도 아니고, 필터박스 내부도 아닐 때 → 닫기
    if (
        e.target !== toggleBtn &&
        !toggleBtn.contains(e.target) &&
        !filterBox.contains(e.target)
    ) {
        filterBox.style.display = "none";
    }
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

document.querySelectorAll(".status-check").forEach(cb => {
    cb.addEventListener("change", () => {
        reloadListingsOnMapThrottled();
    });
});

document.querySelectorAll(".dealtype-check").forEach(cb => {
    cb.addEventListener("change", () => {
        reloadListingsOnMapThrottled();
    });
});

document.querySelectorAll(".category-check").forEach(cb => {
    cb.addEventListener("change", () => {
        reloadListingsOnMapThrottled();
    });
});

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

    // 지도 reload
    reloadListingsOnMapThrottled();
}

// 🔥 초기화 버튼 클릭 시 함수 실행
document.getElementById("filter-reset-btn").addEventListener("click", resetFilterSelections);
