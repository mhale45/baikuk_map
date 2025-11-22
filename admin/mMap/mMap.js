// ▷ 기본 지도 초기화 코드

let map;

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
});

// =============================
// 🔥 Supabase → baikukdbtest 지도 표시
// =============================

// 1) 매물 데이터 불러오기
async function loadBaikukListings() {
    const { data, error } = await window.supabase
        .from("baikukdbtest")
        .select(`
            listing_id,
            listing_title,
            lat,
            lng,
            deal_type,
            sale_price,
            deposit_price,
            monthly_rent
        `);

    if (error) {
        console.error("❌ Supabase 데이터 로딩 오류:", error);
        return [];
    }

    return data;
}

// 2) 지도에 마커 + 클러스터 표시
async function renderListingsOnMap() {
    const listings = await loadBaikukListings();
    if (!listings.length) {
        console.warn("⚠️ 불러올 데이터가 없습니다.");
        return;
    }

    const markers = [];

    listings.forEach(item => {
        if (!item.lat || !item.lng) return;

        const position = new kakao.maps.LatLng(item.lat, item.lng);

        const marker = new kakao.maps.Marker({
            position: position
        });

        // 정보창
        const info = new kakao.maps.InfoWindow({
            content: `
                <div style="padding:8px; font-size:12px;">
                    <b>${item.listing_title || "제목 없음"}</b><br/>
                    매물번호: ${item.listing_id}<br/>
                    유형: ${item.deal_type || "-"}<br/>
                    매매: ${item.sale_price || "-"}<br/>
                    보증금: ${item.deposit_price || "-"} / 월세: ${item.monthly_rent || "-"}
                </div>
            `
        });

        kakao.maps.event.addListener(marker, "click", () => {
            info.open(map, marker);
        });

        markers.push(marker);
    });

    // 3) 카카오 클러스터 설정
    const clusterer = new kakao.maps.MarkerClusterer({
        map: map,
        averageCenter: true,
        minLevel: 5,  //  레벨 5 이상일 때 클러스터링됨
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
