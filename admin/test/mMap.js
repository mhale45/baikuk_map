// ▷ 기본 지도 초기화 코드

let map;
let currentInfoWindow = null;

window.addEventListener("DOMContentLoaded", () => {
    map = new kakao.maps.Map(document.getElementById("map"), {
        center: new kakao.maps.LatLng(37.5665, 126.9780), // 서울 중심
        level: 4
    });

    // 현재 위치 이동 시도
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

    // 🔹 지도 배경을 클릭하면 현재 열린 인포윈도우 닫기
    kakao.maps.event.addListener(map, "click", () => {
        if (currentInfoWindow) {
            currentInfoWindow.close();
            currentInfoWindow = null;
        }
    });
});

function formatNumber(num) {
    if (num === null || num === undefined || num === "-" || num === "") return "-";
    const n = Number(num);
    if (isNaN(n)) return num;
    return n.toLocaleString("ko-KR");
}
// =============================
// 🔥 현재 지도 범위보다 조금 넓게 Supabase 조회
// =============================

// 지도에서 Bound 가져오기 → 보이는 영역보다 30% 큰 검색 범위로 확장
function getExpandedBounds() {
    const bounds = map.getBounds();

    const sw = bounds.getSouthWest(); // 남서쪽
    const ne = bounds.getNorthEast(); // 북동쪽

    const latRange = ne.getLat() - sw.getLat();
    const lngRange = ne.getLng() - sw.getLng();

    return {
        minLat: sw.getLat() - latRange * 0.2,
        maxLat: ne.getLat() + latRange * 0.2,
        minLng: sw.getLng() - lngRange * 0.3,
        maxLng: ne.getLng() + lngRange * 0.3
    };
}

// 🔥 Supabase 범위 조회
async function loadListingsByBounds() {
    const b = getExpandedBounds();

    const { data, error } = await window.supabase
        .from("baikukdbtest")
        .select(`
            listing_id,
            listing_title,
            lat,
            lng,
            deposit_price,
            monthly_rent,
            premium_price,
            area_py
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

        // 🔥 3) 그룹 전체 매물 정보를 줄바꿈으로 생성
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
                width: 360px;             /* 🔥 폭 강제 지정 */
                display: block;           /* 🔥 카카오 기본값 무력화 */
            ">
                ${htmlLines.join("")}
            </div>
        `;

        const info = new kakao.maps.InfoWindow({
            content: infoHtml
        });

        kakao.maps.event.addListener(marker, "click", () => {

            // 이전에 열린 창 닫기
            if (currentInfoWindow) {
                currentInfoWindow.close();
            }

            // 새 창 열기
            info.open(map, marker);
            currentInfoWindow = info;
        });

        markers.push(marker);
    });

    // 🔥 4) 클러스터 추가
    const clusterer = new kakao.maps.MarkerClusterer({
        map: map,
        averageCenter: true,
        minLevel: 5,
        disableClickZoom: false
    });

    clusterer.addMarkers(markers);
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

// 지도 드래그 종료 후
kakao.maps.event.addListener(map, "dragend", reloadListingsOnMapThrottled);

// 지도 확대/축소 후
kakao.maps.event.addListener(map, "zoom_changed", reloadListingsOnMapThrottled);
