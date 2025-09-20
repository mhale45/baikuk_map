import { client } from '../core/supabase-client.js';

const branchInfoCache = new Map();

export async function resolveListingAffiliation(listing){
  // (네 기존 extractAgentKeys + public_staff_view 조회 로직 옮기기)
  // return affiliation || null;
}

export async function fetchBranchInfoByAffiliation(aff){
  if (!aff) return null;
  if (branchInfoCache.has(aff)) return branchInfoCache.get(aff);
  const { data } = await client.from('branch_info')
    .select('affiliation, office_name, full_address, contact_number, registration_number, representative_name, is_public')
    .ilike('affiliation', aff)
    .maybeSingle();
  if (data) branchInfoCache.set(aff, data);
  return data || null;
}
