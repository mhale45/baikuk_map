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

    // 📌 idle 이벤트는 map 생성 후에 반드시 등록해야 함
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

// 2) 지도에 마커 + 클러스터 표시
async function renderListingsOnMap() {

    // ===== 🔥 기존 마커/클러스터 제거 =====
    if (clusterer) {
        clusterer.clear();
        clusterer = null;
    }

    allMarkers.forEach(m => m.setMap(null));
    allMarkers = [];
    // ======================================

    const listings = await loadListingsByBounds();
    if (!listings.length) {
        console.warn("⚠️ 불러올 데이터가 없습니다.");
        return;
    }

    const markers = [];

    // 🔥 1) 좌표(lat, lng) 기준으로 매물 그룹핑
    const grouped = {};
    listings.forEach(item => {
        if (!item.lat || !item.lng) return;

        const key = `${item.lat}_${item.lng}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(item);
    });

    // 🔥 2) 각 그룹마다 마커 1개만 생성
    Object.keys(grouped).forEach(key => {
        const items = grouped[key];
        const first = items[0];

        const position = new kakao.maps.LatLng(first.lat, first.lng);

        const marker = new kakao.maps.Marker({
            position: position
        });

        // (📌 인포윈도우 내용 그대로 유지)
        let htmlLines = items.map(i => {
            return `
                <div style="
                    text-indent: -14px;
                    padding-left: 14px;
                    margin-bottom: 0;
                    white-space: normal;
                    word-break: break-word;
                    overflow-wrap: break-word;
                    word-wrap: break-word;
                    display: block;
                ">
                    🔹 ${i.listing_id} ${i.listing_title || "-"}<br/>
                    &nbsp;${formatNumber(i.deposit_price)} / ${formatNumber(i.monthly_rent)} 권${formatNumber(i.premium_price)} ${i.area_py ? Number(i.area_py).toFixed(1) : "-"}평
                </div>
            `;
        });

        const infoHtml = `
            <div style="
                padding:8px;
                font-size:12px;
                line-height:1.4;
                white-space: normal;
                word-break: break-word;
                overflow-wrap: break-word;
                word-wrap: break-word;
                width: 360px; 
                display: block;
            ">
                ${htmlLines.join("")}
            </div>
        `;

        const info = new kakao.maps.InfoWindow({
            content: infoHtml
        });

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

        markers.push(marker);
    });

    // 🔥 4) 클러스터 추가
    clusterer = new kakao.maps.MarkerClusterer({
        map: map,
        averageCenter: true,
        minLevel: 5,
        disableClickZoom: false
    });

    clusterer.addMarkers(markers);
    allMarkers = markers;
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

// 📌 지도 이동/확대/축소가 완전히 끝난 후 실행됨 (가장 안정적)
kakao.maps.event.addListener(map, "idle", reloadListingsOnMapThrottled);
