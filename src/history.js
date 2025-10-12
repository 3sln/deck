const history = window.history;

// Function to get the current query parameters as an object
export function getQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    q: params.get('q') ?? '',
    c: params.get('c') ?? null,
  };
}

// Function to update the URL with new state
// Uses replaceState to avoid polluting the history for rapid changes
export function replaceState(params) {
  const url = new URL(window.location);
  if (params.hasOwnProperty('q')) {
    if (params.q) url.searchParams.set('q', params.q);
    else url.searchParams.delete('q');
  }
  if (params.hasOwnProperty('c')) {
    if (params.c) url.searchParams.set('c', params.c);
    else url.searchParams.delete('c');
  }
  history.replaceState({}, '', url.toString());
}

// Function to push a new state to the history
// Use this for significant changes, like selecting a new card
export function pushState(params) {
  const url = new URL(window.location);
  if (params.hasOwnProperty('q')) {
    if (params.q) url.searchParams.set('q', params.q);
    else url.searchParams.delete('q');
  }
  if (params.hasOwnProperty('c')) {
    if (params.c) url.searchParams.set('c', params.c);
    else url.searchParams.delete('c');
  }
  history.pushState({}, '', url.toString());
}

// Wrapper for popstate event
export function onPopState(callback) {
  window.addEventListener('popstate', callback);
}
