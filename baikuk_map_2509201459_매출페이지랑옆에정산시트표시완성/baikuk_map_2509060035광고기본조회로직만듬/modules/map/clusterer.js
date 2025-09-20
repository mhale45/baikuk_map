import { state } from '../data/listings-service.js';
import { renderMatchedListings, showDetailPanel } from '../ui/panels.js';
import { CONFIG } from '../core/config.js';
import { loadPrimaryThumbsBatch } from '../images/primary-thumbs.js';

let clusterer;

export function createClusterer(map){
  if (clusterer) clusterer.clear();
  clusterer = new kakao.maps.MarkerClusterer({
    map, averageCenter:true, minLevel:1, minClusterSize:1, disableClickZoom:true, gridSize: 30,
    styles:[{ width:'40px', height:'40px', background:CONFIG.UI.HIGHLIGHT_COLOR, border:'2px solid #F2C130', borderRadius:'50%', color:'#fff', fontWeight:'bold', textAlign:'center', lineHeight:'40px' }]
  });

  kakao.maps.event.addListener(clusterer, 'clusterclick', function(c){
    const listings = c.getMarkers().map(m => state.allListings[m.listing_id]).filter(Boolean);
    state.matched = listings; state.page = 1; renderMatchedListings();
    const ids = listings.map(l=>l.listing_id);
    loadPrimaryThumbsBatch(ids).catch(()=>{});
  });

  return clusterer;
}

export function setClusterMarkers(markers){
  clusterer.clear();
  clusterer.addMarkers(markers);
}
