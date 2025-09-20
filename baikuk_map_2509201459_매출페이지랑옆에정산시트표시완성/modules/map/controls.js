import { getMap } from './map-init.js';

export function bindControls(){
  const map = getMap();
  document.getElementById('btn-zoom-in').addEventListener('click', ()=> map.setLevel(map.getLevel()-1));
  document.getElementById('btn-zoom-out').addEventListener('click', ()=> map.setLevel(map.getLevel()+1));
  document.getElementById('btn-current-location').addEventListener('click', ()=>{
    if (navigator.geolocation){
      navigator.geolocation.getCurrentPosition(pos => {
        map.setCenter(new kakao.maps.LatLng(pos.coords.latitude, pos.coords.longitude));
      });
    }
  });
  document.getElementById('btn-naver-map').addEventListener('click', ()=>{
    const center = map.getCenter();
    const lat = center.getLat(), lng = center.getLng();
    window.open(`https://map.naver.com/v5/?c=${lng},${lat},17,0,0,0,d`, '_blank');
  });
}
