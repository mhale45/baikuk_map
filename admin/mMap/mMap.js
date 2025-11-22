// ▷ 기본 지도 초기화 코드

let map;
let currentInfoWindow = null;
let clusterer = null;
let allMarkers = [];

window.addEventListener("DOMContentLoaded", () => {
    map = new kakao.maps.Map(document.getElementById("map"), {
        center: new kakao.maps.LatLng(37.5665, 126.9780),
        level: 4
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
        if (currentInfoWindow) {
            currentInfoWindow.close();
            currentInfoWindow = null;
        }
    });

    kakao.maps.event.addListener(map, "idle", reloadListingsOnMapThrottled);
});

function formatNumber(num) {
    if (num === null || num === undefined || num === "-" || num === "") return "-";
    const n = Number(num);
    if (isNaN(n)) return num;
    return n.toLocaleString("ko-KR");
}

async function loadListingsByAddress(fullAddress) {
    const { data, error } = await window.supabase
        .from("baikukdbtest")
        .select(`listing_id, listing_title, deposit_price, monthly_rent, premium_price, area_py`)
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

// 지도에서 Bound 가져오기
function getCurrentBounds() {
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

// 🔥 Supabase 범위 조회
async function loadListingsByBounds() {
    const b = getCurrentBounds();

    const { data, error } = await window.supabase
        .from("baikukdbtest_address_view")
        .select(`
            full_address,
            lat,
            lng,
            listing_count
        `)
        .gte("lat", b.minLat)
        .lte("lat", b.maxLat)
        .gte("lng", b.minLng)
        .lte("lng", b.maxLng);

    if (error) {
        console.error("❌ Supabase 범위 조회 오류:", error);
        return [];
    }

    return data;
}

async function renderListingsOnMap() {
    const listings = await loadListingsByBounds();
    if (!listings.length) return;

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

            // 클릭 이벤트 등록
            kakao.maps.event.addListener(marker, "click", async () => {
                if (currentInfoWindow) currentInfoWindow.close();

                const listings = await loadListingsByAddress(item.full_address);

                const html = listings.map(i => `
                    <div style="margin-bottom:6px;">
                        🔹 ${i.listing_id} ${i.listing_title || "-"}<br/>
                        &nbsp;${formatNumber(i.deposit_price)} / ${formatNumber(i.monthly_rent)}
                        권${formatNumber(i.premium_price)} ${i.area_py ?? "-"}평
                    </div>
                `).join("");

                const info = new kakao.maps.InfoWindow({
                    content: `<div style="padding:8px; font-size:12px; width:360px;">${html}</div>`
                });

                info.open(map, marker);
                currentInfoWindow = info;
            });
        }
    });

    // 업데이트된 마커 목록 저장
    allMarkers = Array.from(currentMap.values());
}

// 지도 로딩 후 실행
window.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
        renderListingsOnMap();
    }, 800); // 지도 초기화 후 실행 (지연 설정)
});

// =============================
// 🔥 지도 이동/확대/축소 시 자동 reload
// =============================

let reloadTimer = null;

function reloadListingsOnMapThrottled() {
    if (reloadTimer) clearTimeout(reloadTimer);

    // 400ms 동안 지도 이동이 멈추면 쿼리 실행
    reloadTimer = setTimeout(() => {
        renderListingsOnMap();
    }, 400);
}