export function getQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const versions = new Map();
  try {
    const entries = JSON.parse(params.get('v') ?? '[]');
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (
          Array.isArray(entry) &&
          entry.length === 2 &&
          entry.every(value => typeof value === 'string')
        ) {
          versions.set(...entry);
        }
      }
    }
  } catch {
    // Bookmarks with an invalid version parameter still open the default deck.
  }
  return {q: params.get('q') ?? '', c: params.get('c'), d: params.get('d'), versions};
}

export function urlWithQuery(params) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  return url;
}

function updateUrl(method, params) {
  const url = urlWithQuery(params);
  if (url.href !== window.location.href) window.history[method](window.history.state, '', url);
}

export const replaceState = params => updateUrl('replaceState', params);
export const pushState = params => updateUrl('pushState', params);
