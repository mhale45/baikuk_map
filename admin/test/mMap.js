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

// 🔥 지도 범위 기반 매물 로딩 (Bounding Box)
async function loadBaikukListingsInBounds() {
    const bounds = map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

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
        .gte("lat", sw.getLat())
        .lte("lat", ne.getLat())
        .gte("lng", sw.getLng())
        .lte("lng", ne.getLng())
        .limit(8000);

    if (error) {
        console.error("❌ Supabase 범위 조회 오류:", error);
        return [];
    }

    return data;
}

// 🔥 동일 좌표(lat, lng) 가진 매물 묶어서 조회 후 텍스트박스 출력
async function loadListingsByLatLng(lat, lng, marker) {
    const { data, error } = await window.supabase
        .from("baikukdbtest")
        .select(`
            listing_id,
            listing_title,
            deposit_price,
            monthly_rent,
            premium_price,
            area_py
        `)
        .eq("lat", lat)
        .eq("lng", lng);

    if (error || !data || !data.length) {
        console.error("❌ 매물 조회 오류:", error);
        return;
    }

    // 기존 텍스트박스 방식 유지
    let htmlLines = data.map(i => {
        return `
            <div style="
                text-indent: -14px;
                padding-left: 14px;
                margin-bottom: 6px;
            ">
                🔹 ${i.listing_id} ${i.listing_title || "-"}<br/>
                &nbsp;${formatNumber(i.deposit_price)} / ${formatNumber(i.monthly_rent)} 권${formatNumber(i.premium_price)} ${i.area_py ? Number(i.area_py).toFixed(1) : "-"}평
            </div>
        `;
    });

    const infoHtml = `
        <div style="
            padding:8px;
            font-size:14px;
            line-height:1.4;

            /* 🔥 가로 스크롤을 전체 박스에 적용 */
            white-space: nowrap;     /* 자동 줄바꿈 금지 */
            overflow-x: auto;        /* 가로 스크롤 생성 */

            /* 🔥 세로 스크롤은 유지 */
            max-height: 50vh;
            overflow-y: auto;

            /* 기타 UI 유지 */
            width: 360px;
            display: block;
        ">
            ${htmlLines.join("")}
        </div>
    `;

    const infoWindow = new kakao.maps.InfoWindow({
        content: infoHtml,
    });

    if (currentInfoWindow) currentInfoWindow.close();
    infoWindow.open(map, marker);
    currentInfoWindow = infoWindow;
}

// =======================================================
// 🔥 지번(full_address) 단위 마커 로딩 (지도 범위 + 확장)
// =======================================================

// 마커 & 클러스터러 전역 보관 → 반복 호출 시 삭제 가능
let currentMarkers = [];
let currentClusterer = null;

// 범위 확장 값 (위도/경도 기준)
const BBOX_PADDING = 0.01;  // 약 1km 정도 확장

async function loadGroupedMarkersInExpandedBounds() {
    const bounds = map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    // 🔥 지도 범위를 약간 확장
    const minLat = sw.getLat() - BBOX_PADDING;
    const maxLat = ne.getLat() + BBOX_PADDING;
    const minLng = sw.getLng() - BBOX_PADDING;
    const maxLng = ne.getLng() + BBOX_PADDING;

    // 🔥 지번(full_address) 기준으로 대표 좌표(lat,lng) 1개만 가져오기
    const { data, error } = await window.supabase
        .from("baikukdbtest")
        .select(`
            full_address,
            lat,
            lng
        `)
        .gte("lat", minLat)
        .lte("lat", maxLat)
        .gte("lng", minLng)
        .lte("lng", maxLng)
        .order("full_address", { ascending: true });

    if (error) {
        console.error("❌ BBOX 지번 단위 조회 오류:", error);
        return [];
    }

    // 🔥 지번(full_address) 단위 그룹핑
    const grouped = {};
    data.forEach(item => {
        if (!grouped[item.full_address]) {
            grouped[item.full_address] = {
                lat: item.lat,
                lng: item.lng
            };
        }
    });

    return Object.values(grouped);
}

// =======================================================
// 🔥 지번당 1개의 마커 표시
// =======================================================
async function renderGroupedAddressMarkers() {
    // 🔄 기존 클러스터러 제거
    if (currentClusterer) {
        currentClusterer.clear();
        currentClusterer = null;
    }

    // 🔄 기존 마커 제거
    currentMarkers.forEach(m => m.setMap(null));
    currentMarkers = [];

    const positions = await loadGroupedMarkersInExpandedBounds();
    if (!positions.length) return;

    const markers = [];

    positions.forEach(item => {
        const marker = new kakao.maps.Marker({
            position: new kakao.maps.LatLng(item.lat, item.lng)
        });

        // 🔥 클릭 시 지번 전체 매물 로딩
        kakao.maps.event.addListener(marker, "click", () => {
            loadListingsByLatLng(item.lat, item.lng, marker);
        });

        markers.push(marker);
    });

    // 저장
    currentMarkers = markers;

    // 🔥 클러스터러 생성
    currentClusterer = new kakao.maps.MarkerClusterer({
        map: map,
        averageCenter: true,
        minLevel: 5,
        disableClickZoom: false
    });

    currentClusterer.addMarkers(markers);
}

// =======================================================
// 🔥 지도 이동/확대/축소 시 자동 새로 로딩
// =======================================================
kakao.maps.event.addListener(map, "idle", () => {
    renderGroupedAddressMarkers();
});

// 초기 1회 실행
setTimeout(() => {
    renderGroupedAddressMarkers();
}, 600);
