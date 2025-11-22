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
    zoomNotice.innerText = "지도를 확대하세요 (레벨 4 이하에서 표시됩니다)";
    document.body.appendChild(zoomNotice);

});

function getSelectedStatuses() {
    return Array.from(document.querySelectorAll(".status-check:checked"))
        .map(cb => cb.value);
}

function getSelectedDealTypes() {
    return Array.from(document.querySelectorAll(".dealtype-check:checked"))
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
            deal_type
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
            deal_type
        `)
        .gte("lat", b.minLat).lte("lat", b.maxLat)
        .gte("lng", b.minLng).lte("lng", b.maxLng);

    // 🔥 OR 필터 전체 결합
    let orFilters = [];

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
    const listings = await loadListingsByBounds();

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

    // 2) 새로 추가할 마커 추가
    nextMap.forEach((item, addr) => {
        if (!currentMap.has(addr)) {
            const marker = new kakao.maps.Marker({
                position: new kakao.maps.LatLng(item.lat, item.lng)
            });

            clusterer.addMarker(marker);

            currentMap.set(addr, {
                full_address: addr,
                marker: marker
            });

            kakao.maps.event.addListener(marker, "click", async () => {
                if (currentInfoWindow) currentInfoWindow.close();

                // 🔥 Supabase에서 해당 주소 매물 불러오기
                let listings = await loadListingsByAddress(item.full_address);

                // 🔥 거래상태 필터가 있을 경우 필터링 적용
                const selectedStatuses = getSelectedStatuses();

                if (selectedStatuses.length > 0) {
                    listings = listings.filter(i => {
                        const st = i.transaction_status || "";
                        return selectedStatuses.some(sel => st.includes(sel));
                    });
                }

                // 🔥 정렬 (층수)
                listings.sort((a, b) => {
                    const fa = a.floor ?? 0;
                    const fb = b.floor ?? 0;
                    return fa - fb;
                });

                // 🔥 HTML 생성
                const html = listings.map(i => {
                    const status = i.transaction_status || "";

                    // 🔥 상태에 따른 아이콘 선택
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
                            <!-- 🔥 층수 추가된 부분 -->
                            &nbsp;<strong>${i.floor != null ? i.floor + "층" : "-"}</strong>
                            <strong>${formatNumber(i.deposit_price)}</strong>/
                            <strong>${formatNumber(i.monthly_rent)}</strong>
                            ${
                                (i.premium_price == null || Number(i.premium_price) === 0)
                                    ? "무권리"
                                    : `권<strong>${formatNumber(i.premium_price)}</strong>`
                            }
                            <strong>${i.area_py != null ? Number(i.area_py).toFixed(1) : "-"}</strong>평
                        </div>
                    `;

                }).join("");

                const panel = document.getElementById("side-panel");

                panel.innerHTML = html || "<div>조건에 맞는 매물이 없습니다.</div>";
                panel.style.display = "block";

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
