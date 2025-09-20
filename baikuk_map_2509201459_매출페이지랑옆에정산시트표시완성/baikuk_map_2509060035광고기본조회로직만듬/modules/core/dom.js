export const qs  = (sel, el=document) => el.querySelector(sel);
export const qsa = (sel, el=document) => [...el.querySelectorAll(sel)];
export const show = (elOrId) => (typeof elOrId==='string' ? qs('#'+elOrId) : elOrId)?.classList.remove('hidden');
export const hide = (elOrId) => (typeof elOrId==='string' ? qs('#'+elOrId) : elOrId)?.classList.add('hidden');
export const toggle = (elOrId, on) => (on ? show(elOrId) : hide(elOrId));

export function escapeHtml(s=''){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
