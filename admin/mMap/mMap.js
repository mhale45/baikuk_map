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

/* ======================================================
   🔥 admin/index.html 과 동일한 클러스터 표시 로직
   ====================================================== */
let clusterer;
let selectedClusterEl = null;

// 클러스터 생성 함수
function createClusterer() {
    if (clusterer) clusterer.clear();

    clusterer = new kakao.maps.MarkerClusterer({
        map: map,
        averageCenter: true,
        minLevel: 1,
        minClusterSize: 1,
        disableClickZoom: true,
        gridSize: 80,   // 기본값
        styles: [{
            width: '40px',
            height: '40px',
            background: '#F2C130',
            border: '2px solid #F2C130',
            borderRadius: '50%',
            color: '#fff',
            fontWeight: 'bold',
            textAlign: 'center',
            lineHeight: '40px'
        }]
    });

    // ► 클러스터 클릭 이벤트
    kakao.maps.event.addListener(clusterer, 'clusterclick', function (cluster) {

        // 기존 선택된 클러스터 원복
        if (selectedClusterEl) {
            selectedClusterEl.style.border = "none";
            selectedClusterEl.style.borderRadius = "50%";

            const prevInner = selectedClusterEl.querySelector('div');
            if (prevInner) {
                prevInner.style.background = "#F2C130";
                prevInner.style.color = "#fff";
            }
        }

        // 새로 클릭한 클러스터 DOM
        const clusterEl = cluster.getClusterMarker().getContent().parentNode;
        if (clusterEl) {
            clusterEl.style.background = "transparent";
            clusterEl.style.border = "2px solid #F2C130";
            clusterEl.style.borderRadius = "50%";

            const inner = clusterEl.querySelector('div');
            if (inner) {
                inner.style.background = "#ffffff";
                inner.style.color = "#F2C130";
                inner.style.borderRadius = "50%";
            }
        }

        selectedClusterEl = clusterEl;

        // ▼ admin/index.html 과 동일하게, 클러스터 안의 매물 목록 가져오기
        const markerList = cluster.getMarkers();
        const listings = markerList
            .map(mk => mk.listing_data) // mMap 용 단순 필드
            .filter(Boolean);

        console.log("클러스터 안 매물들:", listings);
    });
}

// ===============================
// 🔥 마커 + 클러스터 적용.
// ===============================
function setMarkersOnMap(list) {
    if (!clusterer) createClusterer();

    // 기존 마커 제거
    clusterer.clear();

    const markers = list.map(l => {
        const marker = new kakao.maps.Marker({
            position: new kakao.maps.LatLng(l.lat, l.lng)
        });

        // admin/index.html 과 같은 구조를 위해 매물 데이터 저장
        marker.listing_data = l;
        return marker;
    });

    clusterer.addMarkers(markers);
}
