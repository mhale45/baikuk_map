import { CONFIG } from './config.js';

export function getListingIdFromURL() {
  const q = new URLSearchParams(location.search).get('id');
  return q && /^\d+$/.test(q) ? q : null;
}

export function updateURLForListing(listingId, replace=false) {
  const url = new URL(location.href);
  if (listingId) url.searchParams.set('id', String(listingId));
  else url.searchParams.delete('id');
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
}

export function redirectWithMessage(msg) {
  const loginUrl = new URL(CONFIG.LOGIN_PAGE, location.origin);
  try { sessionStorage.setItem('auth_msg', String(msg || '')); } catch {}
  if (location.search) loginUrl.search = location.search;
  location.replace(loginUrl.href);
}
