import { client } from '../core/supabase-client.js';

const _nameToExt = new Map();

export async function preloadPublicStaffExtensions(){
  const { data, error } = await client.from('public_staff_view').select('name, extension');
  if (error) return;
  (data||[]).forEach(r => { if (r?.name) _nameToExt.set(r.name.trim(), r.extension||''); });
}

export function getExtensionByName(name){
  return _nameToExt.get(String(name||'').trim()) || '';
}
