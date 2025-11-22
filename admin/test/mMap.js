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

// 🔥 마커용 초경량 데이터 (lat, lng, listing_id만 불러오기)
async function loadMarkerPositions() {
    const { data, error } = await window.supabase
        .from("baikukdbtest")
        .select(`
            listing_id,
            lat,
            lng
        `)
        .not("lat", "is", null)
        .not("lng", "is", null);

    if (error) {
        console.error("❌ 마커 좌표 조회 오류:", error);
        return [];
    }

    return data;
}

// 🔥 마커만 지도에 표시 (정보는 불러오지 않음)
async function renderMarkersOnly() {
    const positions = await loadMarkerPositions();

    if (!positions.length) {
        console.warn("⚠️ 표시할 마커 데이터가 없습니다.");
        return;
    }

    const markers = [];

    positions.forEach(item => {
        const marker = new kakao.maps.Marker({
            position: new kakao.maps.LatLng(item.lat, item.lng)
        });

        // 클릭 시 상세정보 fetch
        kakao.maps.event.addListener(marker, "click", () => {
            loadListingsByLatLng(item.lat, item.lng, marker);
        });

        markers.push(marker);
    });

    const clusterer = new kakao.maps.MarkerClusterer({
        map: map,
        averageCenter: true,
        minLevel: 5,
        disableClickZoom: false
    });

    clusterer.addMarkers(markers);
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
            font-size:13px;
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

// 지도 로딩 후 실행
window.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
        renderMarkersOnly();
    }, 800); // 지도 초기화 후 실행 (지연 설정)
});

// 🔥 지도 이동/줌 시 자동으로 데이터 다시 불러오기
kakao.maps.event.addListener(map, "idle", () => {
    renderMarkersOnly();
});

