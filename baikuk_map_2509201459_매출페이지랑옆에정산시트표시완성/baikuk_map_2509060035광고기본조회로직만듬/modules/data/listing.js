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

/**
 * 매물 row에서 주소 문자열 합치기
 * - 공백으로 연결, 빈 값은 제거
 * - floor → "3층", unit_info → "201호"
 * @param {object} row
 * @returns {string} 주소 문자열
 */
export function buildAddress(row) {
  const floor = row.floor != null && row.floor !== ''
    ? `${row.floor}층`
    : '';
  const unit = row.unit_info != null && row.unit_info !== ''
    ? `${row.unit_info}호`
    : '';

  const parts = [
    row.province,
    row.city,
    row.district,
    row.detail_address, // 번지
    floor,
    unit
  ].map(v => (v == null ? '' : String(v).trim()))
   .filter(Boolean);

  return parts.join(' ');
}
