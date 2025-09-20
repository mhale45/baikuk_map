let map, markerImage;
export function createMap(){
  map = new kakao.maps.Map(document.getElementById('map'), {
    center: new kakao.maps.LatLng(37.7151, 126.7341), level:3
  });
  if (navigator.geolocation){
    navigator.geolocation.getCurrentPosition(pos=>{
      map.setCenter(new kakao.maps.LatLng(pos.coords.latitude, pos.coords.longitude));
    }, ()=>{});
  }
  markerImage = new kakao.maps.MarkerImage(
    'https://raw.githubusercontent.com/mhale45/image/2d7ce4379b14d095d2f0b7f1d0057987548a37bf/2.png',
    new kakao.maps.Size(36,36),
    { offset:new kakao.maps.Point(18,36) }
  );
  return { map, markerImage };
}
export const getMap = ()=>map;
export const getMarkerImage = ()=>markerImage;
