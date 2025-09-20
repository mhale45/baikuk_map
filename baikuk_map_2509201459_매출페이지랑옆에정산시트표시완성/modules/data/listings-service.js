import { client } from '../core/supabase-client.js';
import { CONFIG } from '../core/config.js';

export const state = {
  allListings: {},     // { [id]: row }
  allMarkers:  {},     // { [id]: kakao.maps.Marker }
  matched:    [],      // 필터 후 목록
  page:       1,
  selectedDealTypes: ['월세'],
  selectedCategories: ['상가'],
};

export function setMatched(list){ state.matched = list; state.page = 1; }
export function nextPage(){ state.page += 1; }

export async function loadListingsInBounds(map){
  const bounds = map.getBounds();
  const sw = bounds.getSouthWest(), ne = bounds.getNorthEast();

  const { data, error } = await client.from('public_baikuk_view')
    .select('*')
    .gte('lat', sw.getLat()).lte('lat', ne.getLat())
    .gte('lng', sw.getLng()).lte('lng', ne.getLng())
    .limit(1000);

  if (error) throw error;
  for (const l of (data||[])) if (l.listing_id && !state.allListings[l.listing_id]) state.allListings[l.listing_id] = l;
  return data||[];
}
