// 새 mMap.js (admin 버전과 동일한 클러스터 로직 + 기본 지도 로직 통합)

let map;
let clusterer;
let selectedClusterEl = null;

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

    createClusterer();
});

function createClusterer() {
    if (clusterer) clusterer.clear();

    clusterer = new kakao.maps.MarkerClusterer({
        map: map,
        averageCenter: true,
        minLevel: 1,
        minClusterSize: 1,
        disableClickZoom: true,
        gridSize: 80,
        styles: [{
            width: '40px',
            height: '40px',
            background: 'transparent',
            border: 'none',
            color: '#fff',
            textAlign: 'center',
            lineHeight: '40px',
            fontWeight: 'bold',
            html: `
                <div style="
                    width:40px;
                    height:40px;
                    background:#F2C130;
                    border-radius:50%;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    color:#fff;
                    font-weight:bold;
                    border:2px solid #F2C130;
                "></div>
            `
        }]
    });

    kakao.maps.event.addListener(clusterer, 'clusterclick', function (cluster) {
        if (selectedClusterEl) {
            selectedClusterEl.style.border = "none";
            selectedClusterEl.style.borderRadius = "50%";

            const prevInner = selectedClusterEl.querySelector('div');
            if (prevInner) {
                prevInner.style.background = "#F2C130";
                prevInner.style.color = "#fff";
            }
        }

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

        const markerList = cluster.getMarkers();
        const listings = markerList.map(mk => mk.listing_data).filter(Boolean);

        console.log("클러스터 안 매물들:", listings);
    });
}

function setMarkersOnMap(list) {
    if (!clusterer) createClusterer();

    clusterer.clear();

    const markers = list.map(l => {
        const marker = new kakao.maps.Marker({
            position: new kakao.maps.LatLng(l.lat, l.lng)
        });

        marker.listing_data = l;
        return marker;
    });

    clusterer.addMarkers(markers);
}

/* ======================================================
   🔥 Supabase에서 실제 매물 불러오기
   ====================================================== */
export async function loadListingsFromSupabase() {
    try {
        const { data, error } = await window.supabase
            .from("baikukdbtest")   // ← 실제 테이블명
            .select("listing_id, lat, lng, deal_type, category, title, building_name")
            .eq("transaction_status", "진행중"); // 원하면 조건 삭제 가능

        if (error) {
            console.error("매물 로드 오류:", error);
            return [];
        }

        // 지도에 필요한 최소 정보만 구성
        const list = data
            .filter(item => item.lat && item.lng) // 좌표 없는 매물 제거
            .map(item => ({
                listing_id: item.listing_id,
                lat: item.lat,
                lng: item.lng,
                title: item.title || "",
                category: item.category,
                deal_type: item.deal_type,
                building_name: item.building_name
            }));

        return list;

    } catch (err) {
        console.error("loadListingsFromSupabase() 실패:", err);
        return [];
    }
}
