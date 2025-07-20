import { useEffect } from 'react';

const KakaoMap = () => {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=dc841a1222c4931c4a51b97d979bdcc&autoload=false`;
    script.async = true;

    script.onload = () => {
      window.kakao.maps.load(() => {
        const container = document.getElementById('map');
        const options = {
          center: new window.kakao.maps.LatLng(37.5665, 126.9780),
          level: 3
        };
        new window.kakao.maps.Map(container, options);
      });
    };

    document.head.appendChild(script);
  }, []);

  return <div id="map" style={{ width: '100%', height: '500px' }} />;
};

export default KakaoMap;
