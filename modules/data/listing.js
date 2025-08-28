// modules/data/listing.js
/**
 * 매물 row에서 ID와 제목을 합쳐 표시용 문자열 생성
 * @param {object} row 
 * @param {string|number} [row.listing_id]
 * @param {string} [row.listing_title]
 * @returns {string} "[123] 매물명" 형식 (ID 없으면 제목만)
 */
export function buildListingTitle(row) {
  const id = row.listing_id ? `[${String(row.listing_id).trim()}]` : '';
  const title = row.listing_title ? String(row.listing_title).trim() : '';
  return [id, title].filter(Boolean).join(' ');
}
