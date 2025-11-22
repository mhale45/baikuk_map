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
// 🔥 Supabase → baikukdbtest 지도 표시
// =============================

// 🔥 현재 지도 중심 좌표 기준 반경 2km 매물만 Supabase에서 불러오기 (full_address unique)
async function loadBaikukListingsByRadius() {

    const center = map.getCenter();
    const centerLat = center.getLat();
    const centerLng = center.getLng();

    const R = 6371; // 지구 반경(km)
    const radius = 2; // 2km

    // 위도/경도 범위 계산
    const deltaLat = (radius / R) * (180 / Math.PI);
    const deltaLng = (radius / (R * Math.cos(centerLat * Math.PI / 180))) * (180 / Math.PI);

    const minLat = centerLat - deltaLat;
    const maxLat = centerLat + deltaLat;
    const minLng = centerLng - deltaLng;
    const maxLng = centerLng + deltaLng;

    // 🔥 Supabase에서 범위 검색 + full_address 기준 unique
    const { data, error } = await window.supabase
        .from("baikukdbtest")
        .select(`
            listing_id,
            full_address,
            listing_title,
            lat,
            lng,
            deposit_price,
            monthly_rent,
            premium_price,
            area_py
        `)
        .gte("lat", minLat)
        .lte("lat", maxLat)
        .gte("lng", minLng)
        .lte("lng", maxLng);

    if (error) {
        console.error("❌ 지도 반경 매물 조회 오류:", error);
        return [];
    }

    // 🔥 full_address 기준 unique 처리
    const uniqueMap = new Map();
    data.forEach(item => {
        if (!uniqueMap.has(item.full_address)) {
            uniqueMap.set(item.full_address, item);
        }
    });

    return Array.from(uniqueMap.values());
}

// 2) 지도에 마커 + 클러스터 표시
async function renderListingsOnMap() {
    const listings = await loadBaikukListingsByRadius();
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
