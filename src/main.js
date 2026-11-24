import {composeDecks, normalizeTags, openDeck} from './data.js';
import {createBrowserOfflineStore} from './offline.js';
import {highlight, viewerStylesheet as highlightStylesheet} from './highlight.js';
import {prepareCardContent} from './card-content.js';
import {legacyDeck} from './legacy-view-data.js';
import {setDevMode} from './dev-mode.js';
import {connectHmr} from './dev-runtime.js';
import * as history from './history.js';
import {viewerStyles} from './view-style.js';
import {tokenize} from './tokenize.js';
import './deck-demo.js';

const stylesheet = new CSSStyleSheet();
stylesheet.replaceSync(viewerStyles);

const instances = new WeakMap();
const pageSize = 50;
const searchProgressDelay = 400;
const cardKey = card => card && JSON.stringify([card.deckId, card.path]);
const cardRevision = card =>
  card && JSON.stringify([card.deckId, card.path, card.version, card.hash]);
const versionKey = deck => deck && JSON.stringify([deck.id, deck.version, deck.manifestUrl]);
const hasVersionChoice = deck => (deck.versions?.length ?? 0) > 1;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function action(text, listener, className = '') {
  const button = element('button', `deck-action ${className}`.trim(), text);
  button.type = 'button';
  button.addEventListener('click', listener);
  return button;
}

const iconPaths = {
  search: 'M21 21l-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  filters: 'M4 7h5m5 0h6M4 17h9m5 0h2M9 4v6m4 4v6',
  caret: 'm6 9 6 6 6-6',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M18 6 6 18',
  copy: 'M9 9h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V9Zm6 0V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4',
  back: 'M19 12H5m7-7-7 7 7 7',
  bookmark: 'M6 5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4-6 4Z',
  download: 'M12 3v12m-4-4 4 4 4-4M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
};

function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.7',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  }))
    svg.setAttribute(key, value);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', iconPaths[name]);
  svg.append(path);
  return svg;
}

function labelIcon(button, label) {
  button.title = label;
  button.setAttribute('aria-label', label);
}

function status() {
  const node = element('p', 'deck-status');
  node.setAttribute('role', 'status');
  return node;
}

function addStyles(target) {
  const root = target.getRootNode();
  const styleRoot = 'adoptedStyleSheets' in root ? root : target.ownerDocument;
  for (const sheet of [stylesheet, highlightStylesheet]) {
    if (!styleRoot.adoptedStyleSheets.includes(sheet)) styleRoot.adoptedStyleSheets.push(sheet);
  }
}

function mcpEndpoint(url, signal) {
  const endpoint = element('div', 'deck-mcp-endpoint');
  const address = element('span', 'deck-mcp-url');
  address.title = url;
  const addressText = element('bdi', '', url);
  addressText.dir = 'ltr';
  address.append(addressText);
  const message = element('span', 'deck-mcp-copy-status');
  message.setAttribute('role', 'status');
  let reset;
  const copy = action(
    null,
    async () => {
      let feedback;
      try {
        await navigator.clipboard.writeText(url);
        feedback = 'Copied';
      } catch {
        const range = document.createRange();
        range.selectNodeContents(address);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        feedback = 'Selected';
        try {
          if (document.execCommand('copy')) {
            selection.removeAllRanges();
            feedback = 'Copied';
          }
        } catch {
          // Leave the full endpoint selected for manual copy.
        }
      }
      if (signal.aborted) return;
      message.textContent = feedback;
      clearTimeout(reset);
      reset = setTimeout(() => {
        message.textContent = '';
      }, 2200);
    },
    'deck-mcp-copy',
  );
  if (!String(url).endsWith('/mcp')) copy.append(element('span', 'deck-mcp-label', 'MCP'));
  copy.append(address, icon('copy'));
  labelIcon(copy, 'Copy MCP endpoint');
  signal.addEventListener('abort', () => clearTimeout(reset), {once: true});
  endpoint.append(copy, message);
  return endpoint;
}

export async function renderDeck({
  target,
  manifestUrl,
  version,
  versions,
  defaultVersion,
  decks = [],
  collection: suppliedCollection,
  title,
  brand = {},
  theme = {},
  suggestedTags,
  mcpUrl,
  initialCardsData,
  navigation = Boolean(initialCardsData),
  serviceWorkerUrl,
  offlineStore = createBrowserOfflineStore(),
  pinnedCardPaths,
  dev = false,
  searchIndexUrl = dev ? null : './deck-search-index.json',
}) {
  instances.get(target)?.dispose();
  setDevMode(dev);
  addStyles(target);

  const controller = new AbortController();
  const {signal} = controller;
  const view = element('section', 'deck-viewer');
  const brandLink = element(brand.homeUrl ? 'a' : 'p', 'deck-brand');
  const brandName = element('span');
  if (brand.homeUrl) brandLink.href = brand.homeUrl;
  if (brand.logoUrl) {
    const logo = element('img');
    logo.src = brand.logoUrl;
    logo.alt = '';
    brandLink.append(logo);
  }
  brandLink.append(brandName);

  const showBrand = Boolean(brand.homeUrl || brand.logoUrl || brand.name);
  for (const [property, value] of Object.entries(theme)) {
    view.style.setProperty(property.startsWith('--') ? property : `--deck-${property}`, value);
  }

  const workspace = element('div', 'deck-workspace');
  const sidebar = element('div', 'deck-sidebar list-view');
  const search = element('input', 'deck-search');
  search.type = 'search';
  search.disabled = true;
  search.setAttribute('aria-label', 'Search cards');
  const searchBar = element('div', 'deck-search-bar search-bar');
  const searchIcon = element('span', 'deck-search-icon');
  searchIcon.append(icon('search'));
  const options = element('details', 'deck-search-options');
  options.hidden = true;
  const trigger = element('summary', 'deck-filter-trigger');
  labelIcon(trigger, 'Search filters and options');
  const indicator = element('span', 'deck-filter-indicator');
  indicator.hidden = true;
  trigger.append(icon('filters'), indicator);
  const filterPanel = element('div', 'deck-filter-panel');
  filterPanel.setAttribute('popover', 'manual');
  filterPanel.setAttribute('role', 'dialog');
  filterPanel.setAttribute('aria-label', 'Search filters');
  const sheetHeader = element('div', 'deck-filter-sheet-header');
  const sheetClose = action(null, closeFilters, 'deck-filter-close');
  sheetClose.append(icon('close'));
  labelIcon(sheetClose, 'Close filters');
  sheetHeader.append(element('h2', '', 'Filters'), sheetClose);
  filterPanel.append(sheetHeader);
  const projects = element('section', 'deck-projects');
  const tagSection = element('section', 'deck-filter-section');
  const panelTags = element('div', 'deck-panel-tags');
  panelTags.setAttribute('role', 'group');
  panelTags.setAttribute('aria-label', 'Filter by tag');
  tagSection.hidden = true;
  tagSection.append(element('h2', 'deck-filter-heading', 'Tags'), panelTags);
  if (showBrand) filterPanel.append(brandLink);
  filterPanel.append(projects, tagSection);
  options.append(trigger, filterPanel);
  const heroUrl = brand.heroUrl ?? brand.logoUrl;
  const hero = heroUrl && element(brand.homeUrl ? 'a' : 'div', 'deck-brand-hero');
  const searchBrand = brand.logoUrl && element('img', 'deck-search-brand');
  let heroImage;
  if (hero) {
    if (brand.homeUrl) hero.href = brand.homeUrl;
    hero.classList.toggle('deck-wide-hero', Boolean(brand.heroUrl));
    heroImage = element('img');
    heroImage.src = heroUrl;
    hero.append(heroImage);
    sidebar.append(hero);
  }
  if (searchBrand) {
    searchBrand.src = brand.logoUrl;
    searchBrand.alt = '';
    searchBrand.hidden = true;
  }
  searchBar.append(searchIcon);
  if (searchBrand) searchBar.append(searchBrand);
  searchBar.append(search, options);
  const shortcuts = element('div', 'deck-shortcuts');
  shortcuts.setAttribute('role', 'group');
  shortcuts.setAttribute('aria-label', 'Quick filters');
  shortcuts.hidden = true;
  const endpoint = mcpUrl && mcpEndpoint(mcpUrl, signal);
  const loadFeedback = element('div', 'deck-load-feedback');
  const loadStatus = status();
  const retryLoad = action('Retry loading decks', () => loadCollection());
  retryLoad.hidden = true;
  loadFeedback.append(loadStatus, retryLoad);
  const searchFeedback = element('div', 'deck-search-feedback');
  const searchStatus = status();
  const retrySearch = action('Retry search', () => {
    if (!retrySearch.hasAttribute('aria-disabled')) updateList({retry: true});
  });
  retrySearch.hidden = true;
  searchFeedback.append(searchStatus, retrySearch);
  const versionStatus = status();
  const offlineStatus = status();
  const projectFeedback = element('div');
  const sidebarFeedback = element('div');
  projectFeedback.append(versionStatus, offlineStatus);
  sidebarFeedback.append(projectFeedback);
  const results = element('div', 'deck-results card-list');
  sidebar.append(searchBar, shortcuts);
  if (endpoint) sidebar.append(endpoint);
  sidebar.append(loadFeedback, searchFeedback, sidebarFeedback, results);

  const detail = element('article', 'deck-detail detail-view');
  detail.hidden = true;
  const detailTools = element('div', 'deck-detail-tools');
  const close = action(
    'Back',
    () => selectCard(null, {navigate: true, focus: true}),
    'deck-detail-back',
  );
  close.prepend(icon('back'));
  labelIcon(close, 'Close card');
  const save = action(
    null,
    () => {
      const card = selected;
      const deck = deckFor(card);
      const {path} = card;
      const saved = offline.get(versionKey(deck)).cardPaths.includes(path);
      return changeOffline(deck, () => (saved ? deck.removeSavedCard(path) : deck.saveCard(path)), {
        card,
        remove: saved,
      });
    },
    'deck-detail-download',
  );
  save.append(icon('bookmark'));
  labelIcon(save, 'Save card offline');
  save.hidden = true;
  detailTools.append(close, save);
  const detailContext = element('p', 'deck-detail-context');
  detailContext.hidden = true;
  const detailTitle = element('h1');
  detailTitle.tabIndex = -1;
  const detailStatus = status();
  const retryCard = action('Retry card', () => selectCard(selected, {focus: true, record: false}));
  retryCard.hidden = true;
  const detailOfflineStatus = status();
  const content = element('section', 'deck-content');
  detail.append(
    detailTools,
    detailContext,
    detailTitle,
    detailStatus,
    retryCard,
    detailOfflineStatus,
    content,
  );

  workspace.append(sidebar, detail);
  view.append(workspace);
  target.replaceChildren(view);

  function closeFilters() {
    options.open = false;
    trigger.focus();
  }

  function placeFilters() {
    const bounds = searchBar.getBoundingClientRect();
    const width = Math.min(384, bounds.width);
    const below = window.innerHeight - bounds.bottom - 16;
    const above = bounds.top - 16;
    const upward = below < Math.min(280, above);
    const maxHeight = Math.max(80, upward ? above : below);
    const style = filterPanel.style;
    style.setProperty('--deck-filter-width', `${width}px`);
    style.setProperty('--deck-filter-left', `${Math.max(8, bounds.right - width)}px`);
    style.setProperty('--deck-filter-height', `${maxHeight}px`);
    style.setProperty('--deck-filter-top', upward ? 'auto' : `${bounds.bottom + 7}px`);
    style.setProperty(
      '--deck-filter-bottom',
      upward ? `${window.innerHeight - bounds.top + 7}px` : 'auto',
    );
  }

  options.addEventListener('toggle', () => {
    if (options.open) {
      filterPanel.insertBefore(projectFeedback, projects);
      placeFilters();
      filterPanel.showPopover();
    } else {
      filterPanel.querySelector('.deck-version-menu:popover-open')?.hidePopover();
      filterPanel.hidePopover();
      sidebarFeedback.append(projectFeedback);
    }
  });
  document.addEventListener(
    'pointerdown',
    event => {
      if (!options.open) return;
      const path = event.composedPath();
      if (!path.includes(options)) {
        options.open = false;
      } else if (path[0] === filterPanel) {
        const {left, top, right, bottom} = filterPanel.getBoundingClientRect();
        if (
          event.clientX < left ||
          event.clientX > right ||
          event.clientY < top ||
          event.clientY > bottom
        ) {
          closeFilters();
        }
      }
    },
    {signal},
  );
  options.addEventListener('keydown', event => {
    if (
      event.key !== 'Escape' ||
      !options.open ||
      event.defaultPrevented ||
      filterPanel.querySelector('.deck-version-menu:popover-open')
    )
      return;
    event.preventDefault();
    closeFilters();
  });

  const primarySpec =
    manifestUrl || versions ? {manifestUrl, version, versions, defaultVersion} : undefined;
  const sourceSpecs = [...(primarySpec ? [primarySpec] : []), ...decks].map(source => {
    const spec =
      typeof source === 'string' || source instanceof URL ? {manifestUrl: source} : source;
    return {
      ...spec,
      ...(spec.manifestUrl && {manifestUrl: new URL(spec.manifestUrl, document.baseURI).href}),
      ...(Array.isArray(spec.versions) && {
        versions: spec.versions.map(entry => ({
          ...entry,
          ...(entry?.manifestUrl && {
            manifestUrl: new URL(entry.manifestUrl, document.baseURI).href,
          }),
        })),
      }),
    };
  });
  const legacyCards =
    !suppliedCollection && !sourceSpecs.length && initialCardsData ? [...initialCardsData] : null;
  const primarySource = sourceSpecs[0] ?? {manifestUrl: './deck-manifest.json'};
  const sourceManifest = source => source.manifestUrl ?? source.versions?.[0]?.manifestUrl;
  const primaryUrl = new URL(
    sourceManifest(primarySource) ?? './deck-manifest.json',
    document.baseURI,
  );
  const primaryDeckId = suppliedCollection?.decks[0]?.id ?? primarySource.id ?? primaryUrl.href;
  const devBase = dev ? new URL('.', primaryUrl).href : undefined;
  const qualifyRoutes = (suppliedCollection?.decks.length ?? sourceSpecs.length) > 1;

  const tagsSelected = new Map();
  const offline = new Map();
  const pending = new Set();
  const versionRequests = new Map();
  const versionsShown = new Map();
  const projectRows = new Map();
  const shortcutProjects = new Map();
  let openVersionPicker;
  function placeMenus() {
    if (options.open) placeFilters();
    if (openVersionPicker) placeVersions(openVersionPicker);
  }
  window.addEventListener('resize', placeMenus, {signal});
  document.addEventListener('scroll', placeMenus, {signal, capture: true, passive: true});
  const cardButtons = new Map();
  let recents = [];
  let query = navigation ? history.getQueryParams().q : '';
  let selected;
  let collection;
  let unsubscribe;
  let limit = pageSize;
  let loadRevision = 0;
  let searchRevision = 0;
  let searchFailure;
  let searchProgress;
  let retryingSearch = false;
  let detailRevision = 0;
  let navigationRevision = 0;

  const instance = {
    get collection() {
      return collection;
    },
    dispose() {
      if (signal.aborted) return;
      controller.abort();
      unsubscribe?.();
      view.remove();
      if (instances.get(target) === instance) instances.delete(target);
    },
  };
  instances.set(target, instance);
  signal.addEventListener('abort', () => clearTimeout(searchProgress), {once: true});

  const deckFor = card => collection?.decks.find(deck => deck.id === card?.deckId);
  const filterDecks = () =>
    collection.decks.filter(deck => deck.cards.length || hasVersionChoice(deck));

  function versionQuery() {
    const choices = collection.decks.filter(hasVersionChoice).map(deck => [deck.id, deck.version]);
    return choices.length ? JSON.stringify(choices) : null;
  }

  function cardQuery(card) {
    return {
      c: card?.slug || card?.path,
      d: qualifyRoutes ? card?.deckId : null,
      v: versionQuery(),
    };
  }

  function routedCard(c, d) {
    if (!c) return;
    const cards = collection.listCards();
    if (d) {
      const scoped = cards.filter(card => card.deckId === d);
      return scoped.find(card => card.slug === c) ?? scoped.find(card => card.path === c);
    }
    const qualified = cards.find(card => cardKey(card) === c);
    if (qualified) return qualified;
    const matches = cards.filter(card => card.slug === c || card.path === c);
    return (
      matches.find(card => card.deckId === primaryDeckId) ??
      (matches.length === 1 ? matches[0] : undefined)
    );
  }

  function updateBrand() {
    const name =
      brand.name ??
      title ??
      (collection?.decks.length === 1 ? collection.decks[0].title : undefined);
    brandName.textContent = name ?? 'Deck';
    if (heroImage) heroImage.alt = name ?? 'Documentation';
    brandLink.hidden =
      !showBrand ||
      (!brand.homeUrl &&
        !brand.logoUrl &&
        collection?.decks.some(deck => deck.cards.length && deck.title === name));
    search.placeholder = name && name !== 'Deck' ? `Search ${name}…` : 'Search cards…';
    updateBrandSize();
  }

  function updateBrandSize() {
    const searching = Boolean(query.trim());
    const compact = searching || Boolean(selected);
    if (endpoint) endpoint.hidden = searching;
    if (hero) hero.hidden = compact;
    if (searchBrand) searchBrand.hidden = !compact;
    searchIcon.hidden = Boolean(searchBrand && compact);
  }

  function recordRecent(card) {
    const key = cardKey(card);
    recents = [key, ...recents.filter(recent => recent !== key)].slice(0, 25);
  }

  function updateOfflineControls() {
    for (const {deck, button} of projectRows.values()) {
      if (!button) continue;
      const key = versionKey(deck);
      const state = offline.get(key);
      button.disabled = !state || pending.has(key);
      if (!state) continue;
      labelIcon(
        button,
        state.projectSaved ? `Remove offline copy of ${deck.title}` : `Save ${deck.title} offline`,
      );
      button.setAttribute('aria-pressed', String(state.projectSaved));
    }

    const deck = deckFor(selected);
    const key = versionKey(deck);
    const state = offline.get(key);
    save.hidden = !state;
    if (state) {
      const cardSaved = state.cardPaths.includes(selected.path);
      save.disabled = pending.has(key);
      labelIcon(
        save,
        cardSaved
          ? 'Remove card download'
          : state.projectSaved
            ? 'Keep card offline'
            : 'Save card offline',
      );
      save.setAttribute('aria-pressed', String(cardSaved));
    }
  }

  async function readOfflineState(deck) {
    const key = versionKey(deck);
    const isCurrent = () =>
      !signal.aborted && collection.decks.includes(deck) && versionKey(deck) === key;
    try {
      const state = await deck.offlineStatus();
      if (isCurrent()) offline.set(key, state);
    } catch {
      if (isCurrent()) {
        offlineStatus.textContent = 'Offline storage is unavailable.';
      }
    }
    if (!signal.aborted) updateOfflineControls();
  }

  async function changeOffline(deck, operation, {card, remove}) {
    const key = versionKey(deck);
    if (pending.has(key)) return;
    pending.add(key);
    const message = card ? detailOfflineStatus : offlineStatus;
    const subject = card ? 'this card' : deck.title;
    const isCurrent = () =>
      !signal.aborted &&
      collection.decks.includes(deck) &&
      key === versionKey(deck) &&
      (!card || cardRevision(selected) === cardRevision(card));
    message.textContent = remove
      ? `Removing offline copy of ${subject}…`
      : `Saving ${subject} offline…`;
    updateOfflineControls();
    try {
      await operation();
      if (isCurrent()) {
        message.textContent = remove ? 'Offline copy removed.' : 'Saved for offline use.';
      }
    } catch {
      if (isCurrent()) {
        message.textContent = 'The download could not be changed. Try again.';
      }
    } finally {
      pending.delete(key);
      if (!signal.aborted) {
        const current = collection.decks.find(candidate => candidate.id === deck.id);
        if (current && key === versionKey(current)) await readOfflineState(current);
        else offline.delete(key);
      }
    }
  }

  async function chooseVersion(deck, target, picker) {
    const current = collection;
    if (versionRequests.has(deck) || deck.version === target) {
      picker.menu.hidePopover();
      picker.button.focus();
      return;
    }
    ++navigationRevision;
    picker.menu.hidePopover();
    const name = deck.versions.find(entry => entry.id === target)?.title ?? target;
    const loadingMessage = `Loading ${name} of ${deck.title}…`;
    versionRequests.set(deck, loadingMessage);
    versionStatus.textContent = loadingMessage;
    updateProjectControls();
    let message = '';
    try {
      const changed = await current.setVersion(deck.id, target);
      if (!changed || signal.aborted || collection !== current) return;
      if (navigation) history.pushState(cardQuery(selected));
      if (selected && !qualifyRoutes) {
        options.open = false;
        trigger.focus();
      }
    } catch {
      message = `Could not load ${name} of ${deck.title}. Try choosing it again.`;
    } finally {
      versionRequests.delete(deck);
      if (!signal.aborted && current === collection) {
        if (message || versionStatus.textContent === loadingMessage) {
          const pendingVersion = current.decks.find(candidate => versionRequests.has(candidate));
          versionStatus.textContent = message || versionRequests.get(pendingVersion) || '';
        }
        updateProjectControls();
        const focused = view.getRootNode().activeElement;
        if ((!picker.inFilters || options.open) && (!focused || focused === document.body)) {
          picker.button.focus({preventScroll: true});
        }
      }
    }
  }

  function placeVersions({button, menu}) {
    const bounds = button.getBoundingClientRect();
    const width = Math.min(216, window.innerWidth - 24);
    const below = window.innerHeight - bounds.bottom - 12;
    const above = bounds.top - 12;
    const upward = below < Math.min(168, above);
    Object.assign(menu.style, {
      width: `${width}px`,
      left: `${Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12))}px`,
      top: upward ? 'auto' : `${bounds.bottom + 5}px`,
      bottom: upward ? `${window.innerHeight - bounds.top + 5}px` : 'auto',
      maxHeight: `${Math.max(48, upward ? above : below)}px`,
    });
  }

  function versionPicker(deck, inFilters) {
    const button = element('button', 'deck-version-trigger');
    const label = element('span');
    const menu = element('div', 'deck-version-menu');
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.popoverTargetElement = menu;
    button.append(label, icon('caret'));
    menu.setAttribute('popover', 'auto');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', `Versions for ${deck.title}`);
    const entries = new Map();
    const picker = {button, label, menu, entries, inFilters};
    for (const entry of deck.versions) {
      const option = action(
        null,
        () => chooseVersion(deck, entry.id, picker),
        'deck-version-option',
      );
      option.append(element('span', '', entry.title), icon('check'));
      option.setAttribute('role', 'menuitemradio');
      option.tabIndex = -1;
      entries.set(entry.id, option);
      menu.append(option);
    }
    menu.addEventListener('beforetoggle', event => {
      const open = event.newState === 'open';
      button.setAttribute('aria-expanded', String(open));
      if (open) {
        openVersionPicker = picker;
        placeVersions(picker);
      } else if (openVersionPicker === picker) {
        openVersionPicker = undefined;
      }
    });
    menu.addEventListener('toggle', event => {
      if (event.newState === 'open') (entries.get(deck.version) ?? menu.firstElementChild)?.focus();
    });
    menu.addEventListener('keydown', event => {
      const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
      const key = keys.indexOf(event.key);
      if (key < 0) return;
      const items = [...entries.values()];
      const index = items.indexOf(event.target);
      const next =
        key < 2
          ? (index + (key === 0 ? 1 : -1) + items.length) % items.length
          : key === 2
            ? 0
            : items.length - 1;
      event.preventDefault();
      items[next]?.focus();
    });
    return picker;
  }

  function projectChip(deck, canToggle, inFilters) {
    const chip = element('div', 'deck-project-chip');
    let toggle;
    if (canToggle) {
      toggle = action(
        null,
        () => collection.setEnabled(deck.id, !collection.isEnabled(deck.id)),
        'deck-project-toggle',
      );
      toggle.append(icon('check'), element('span', '', deck.title));
      chip.append(toggle);
    }
    const picker = hasVersionChoice(deck) ? versionPicker(deck, inFilters) : undefined;
    if (picker) chip.append(picker.button, picker.menu);
    return {deck, chip, toggle, picker};
  }

  function updateProjectControls() {
    for (const {deck, toggle, picker} of [...projectRows.values(), ...shortcutProjects.values()]) {
      if (toggle) toggle.setAttribute('aria-pressed', String(collection.isEnabled(deck.id)));
      if (picker) {
        const current = deck.versions.find(entry => entry.id === deck.version);
        picker.label.textContent = current?.title ?? deck.version;
        picker.button.disabled = versionRequests.has(deck);
        labelIcon(picker.button, `Version for ${deck.title}, ${picker.label.textContent}`);
        for (const [id, option] of picker.entries) {
          option.setAttribute('aria-checked', String(id === deck.version));
        }
      }
    }
  }

  function renderProjects() {
    projectRows.clear();
    const decks = filterDecks();
    const showProjects = qualifyRoutes || decks.some(deck => !collection.isEnabled(deck.id));
    const rows = element('div', 'deck-project-list');

    for (const deck of decks) {
      if (!showProjects && !deck.offlineAvailable && !hasVersionChoice(deck)) continue;
      const row = element('div', 'deck-project-row');
      const controls = projectChip(deck, showProjects, true);
      if (controls.chip.childElementCount) row.append(controls.chip);
      else row.append(element('span', 'deck-offline-label', 'Offline access'));

      let button;
      if (deck.offlineAvailable) {
        button = action(
          null,
          () => {
            const saved = offline.get(versionKey(deck)).projectSaved;
            return changeOffline(
              deck,
              () => (saved ? deck.removeSavedProject() : deck.saveProject()),
              {remove: saved},
            );
          },
          'deck-project-download',
        );
        button.append(icon('download'));
        labelIcon(button, `Save ${deck.title} offline`);
        row.append(button);
      }

      projectRows.set(deck.id, {...controls, button});
      rows.append(row);
    }

    projects.hidden = !projectRows.size;
    projects.replaceChildren(
      ...(showProjects ? [element('h2', 'deck-filter-heading', 'Projects')] : []),
      rows,
    );
    updateProjectControls();
    updateOfflineControls();
  }

  function chips(container, choices) {
    const active = container.getRootNode().activeElement;
    const focused = container.contains(active) ? active.dataset.filterKey : undefined;
    container.replaceChildren(
      ...choices.map(({key, title, pressed, activate}) => {
        const button = action(title, activate, 'deck-chip');
        button.dataset.filterKey = key;
        button.setAttribute('aria-pressed', String(pressed));
        return button;
      }),
    );
    if (focused) [...container.children].find(node => node.dataset.filterKey === focused)?.focus();
  }

  function tagChoices(labels) {
    return labels.map(title => {
      const key = title.toLowerCase();
      return {
        key,
        title,
        pressed: tagsSelected.has(key),
        activate() {
          if (tagsSelected.has(key)) tagsSelected.delete(key);
          else tagsSelected.set(key, title);
          limit = pageSize;
          updateFilters();
          updateList();
        },
      };
    });
  }

  function updateFilters() {
    const available = normalizeTags(collection.listCards().flatMap(card => card.tags));
    const listed = normalizeTags([...available, ...tagsSelected.values()]);
    tagSection.hidden = !listed.length;
    chips(panelTags, tagChoices(listed));

    const suggested =
      typeof suggestedTags === 'function'
        ? suggestedTags({collection})
        : (suggestedTags ?? collection.suggestedTags());
    const availableKeys = new Set(available.map(tag => tag.toLowerCase()));
    const likely =
      available.length > 2
        ? normalizeTags(suggested).filter(tag => availableKeys.has(tag.toLowerCase()))
        : [];
    const selectedTags = [...tagsSelected.values()];
    const tagShortcuts = normalizeTags([...selectedTags, ...likely]).slice(
      0,
      Math.max(4, selectedTags.length),
    );
    const decks = filterDecks();
    const showProjectShortcuts = !tagShortcuts.length && decks.length >= 2 && decks.length <= 3;
    const sameProjects =
      shortcutProjects.size === decks.length &&
      decks.every(deck => shortcutProjects.get(deck.id)?.deck === deck);
    if (showProjectShortcuts) {
      if (!sameProjects) {
        shortcutProjects.clear();
        shortcuts.replaceChildren(
          ...decks.map(deck => {
            const controls = projectChip(deck, true, false);
            shortcutProjects.set(deck.id, controls);
            return controls.chip;
          }),
        );
      }
    } else {
      shortcutProjects.clear();
      chips(shortcuts, tagChoices(tagShortcuts));
    }
    shortcuts.hidden = !showProjectShortcuts && !tagShortcuts.length;
    shortcuts.classList.toggle('deck-project-shortcuts', showProjectShortcuts);
    shortcuts.classList.toggle(
      'deck-all-projects',
      decks.every(deck => collection.isEnabled(deck.id)),
    );
    updateProjectControls();
    indicator.hidden =
      !tagsSelected.size &&
      decks.every(
        deck =>
          collection.isEnabled(deck.id) &&
          (!hasVersionChoice(deck) || deck.version === deck.defaultVersion),
      );
    options.hidden = !projectRows.size && tagSection.hidden && brandLink.hidden;
    if (options.hidden) options.open = false;
  }

  function resultGroup(title, items) {
    const section = element('section');
    const list = element('ul', 'deck-cards');
    if (title) section.append(element('h2', 'deck-section-heading', title));
    section.append(list);
    for (const card of items) {
      const li = element('li');
      const button = element(navigation ? 'a' : 'button', 'deck-card card-list-item');
      const key = cardKey(card);
      if (navigation) {
        button.href = history.urlWithQuery(cardQuery(card)).href;
      } else {
        button.type = 'button';
      }
      button.addEventListener('click', event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        selectCard(card, {navigate: true, focus: true});
      });
      button.setAttribute('aria-current', String(selected != null && cardKey(selected) === key));
      button.append(element('span', 'deck-card-title', card.title));
      if (card.summary) button.append(element('span', 'deck-card-summary', card.summary));
      if (collection.decks.length > 1)
        button.append(element('span', 'deck-card-project', card.deckTitle));
      cardButtons.set(key, button);
      li.append(button);
      list.append(li);
    }
    return section;
  }

  function browseGroups() {
    const all = collection.listCards();
    if (tagsSelected.size) {
      const tags = [...tagsSelected.keys()];
      const tagged = all.filter(card =>
        tags.every(tag => card.tags?.some(value => value.toLowerCase() === tag)),
      );
      return [['Results', tagged]];
    }
    const pinned = collection.listPinned();
    const pinnedKeys = new Set(pinned.map(cardKey));
    const byKey = new Map(all.map(card => [cardKey(card), card]));
    const recent = recents
      .filter(key => !pinnedKeys.has(key))
      .map(key => byKey.get(key))
      .filter(Boolean);
    const excluded = new Set([...pinnedKeys, ...recent.map(cardKey)]);
    return [
      ['Pinned', pinned],
      ['Recent', recent],
      ['All cards', all.filter(card => !excluded.has(cardKey(card)))],
    ];
  }

  function clearSearchProgress() {
    clearTimeout(searchProgress);
    delete searchFeedback.dataset.loading;
    delete results.dataset.searchLoading;
    results.removeAttribute('aria-busy');
  }

  async function updateList({retry = false} = {}) {
    if (!collection) return;
    const revision = ++searchRevision;
    const decks = filterDecks();
    const enabledDecks = collection.decks.filter(deck => collection.isEnabled(deck.id));
    const searchableDecks = enabledDecks.filter(deck => deck.cards.length);
    const scope = JSON.stringify(searchableDecks.map(versionKey));
    if (searchFailure?.collection !== collection || searchFailure.scope !== scope) {
      searchFailure = undefined;
      retryingSearch = false;
      searchStatus.textContent = '';
    }
    if (retry) retryingSearch = true;
    const textQuery = tokenize(query).length ? query : '';
    const attemptedQuery = textQuery || (retryingSearch && searchFailure?.query);
    const showingProgress = searchFeedback.hasAttribute('data-loading');
    let groups;
    clearSearchProgress();
    search.disabled = !collection.decks.length || Boolean(searchFailure?.complete);
    retrySearch.hidden = !searchFailure;
    retrySearch.removeAttribute('aria-disabled');

    if (attemptedQuery && searchableDecks.length && (retryingSearch || !searchFailure?.complete)) {
      const unavailable = new Set();
      let matches;
      retrySearch.setAttribute('aria-disabled', 'true');
      results.setAttribute('aria-busy', 'true');
      const showProgress = () => {
        searchFeedback.dataset.loading = '';
        searchStatus.textContent = 'Loading search…';
        if (!searchFailure?.complete) results.dataset.searchLoading = '';
      };
      if (showingProgress) showProgress();
      else searchProgress = setTimeout(showProgress, searchProgressDelay);
      try {
        matches = await collection.search({
          query: attemptedQuery,
          tags: [...tagsSelected.values()],
          limit: limit + 1,
          onError: (_, deck) => unavailable.add(deck.id),
        });
      } catch {
        for (const deck of searchableDecks) unavailable.add(deck.id);
      }
      if (signal.aborted || revision !== searchRevision) return;
      clearSearchProgress();
      retryingSearch = false;
      const failedDecks = searchableDecks.filter(deck => unavailable.has(deck.id));
      searchFailure = failedDecks.length
        ? {
            collection,
            scope,
            query: attemptedQuery,
            titles: failedDecks.map(deck => deck.title),
            complete: failedDecks.length === searchableDecks.length,
          }
        : undefined;
      if (textQuery && !searchFailure?.complete) groups = [['Results', matches]];
    }

    groups ??= browseGroups();
    const active = results.getRootNode().activeElement;
    const oldFocus = results.contains(active)
      ? [...cardButtons].find(([, button]) => button === active)?.[0]
      : undefined;
    search.disabled = !collection.decks.length || Boolean(searchFailure?.complete);
    retrySearch.hidden = !searchFailure;
    retrySearch.removeAttribute('aria-disabled');
    if (searchFailure?.complete && active === search) retrySearch.focus({preventScroll: true});
    if (!searchFailure && active === retrySearch) search.focus({preventScroll: true});
    cardButtons.clear();
    results.replaceChildren();
    const visibleGroups = groups.filter(([, items]) => items.length);
    let message = '';
    if (searchFailure?.complete) {
      message = 'Search could not be loaded. You can still browse cards.';
    } else if (searchFailure) {
      message = `Search is unavailable for ${searchFailure.titles.join(', ')}.`;
    } else if (decks.length && !enabledDecks.length) {
      message = 'No projects selected.';
    } else if (collection.decks.length && !visibleGroups.length) {
      message = textQuery || tagsSelected.size ? 'No matching cards.' : 'No cards available.';
    }
    searchStatus.textContent = message;
    for (const [label, items] of visibleGroups) {
      const heading = label === 'All cards' && visibleGroups.length === 1 ? '' : label;
      results.append(resultGroup(heading, items.slice(0, limit)));
    }
    if (groups.some(([, items]) => items.length > limit)) {
      results.append(
        action('Show more cards', () => {
          limit += pageSize;
          updateList();
        }),
      );
    }
    if (oldFocus) cardButtons.get(oldFocus)?.focus({preventScroll: true});
  }

  async function selectCard(card, {navigate = false, focus = false, record = true} = {}) {
    const previous = selected;
    selected = card;
    updateBrandSize();
    const revision = ++detailRevision;
    if (navigation && navigate) history.pushState(cardQuery(card));
    workspace.classList.toggle('has-selection', Boolean(card));
    if (card && options.open && getComputedStyle(sidebar).display === 'none') options.open = false;
    detail.hidden = !card;
    content.replaceChildren();
    detailOfflineStatus.textContent = '';
    detailStatus.textContent = '';
    retryCard.hidden = true;
    content.removeAttribute('aria-busy');
    updateOfflineControls();
    if (!card) {
      updateList();
      if (focus) ((previous && cardButtons.get(cardKey(previous))) || search).focus();
      return;
    }

    detailTitle.textContent = card.title;
    const deck = deckFor(card);
    const versionTitle = hasVersionChoice(deck)
      ? deck.versions.find(entry => entry.id === deck.version)?.title
      : undefined;
    const context =
      collection.decks.length > 1 || versionTitle
        ? [deck.title, versionTitle].filter(Boolean).join(' · ')
        : '';
    detailContext.hidden = !context;
    detailContext.textContent = context;
    detailStatus.textContent = 'Loading card…';
    content.setAttribute('aria-busy', 'true');
    if (record) recordRecent(card);
    updateList();
    if (focus) detailTitle.focus();

    try {
      const loaded = await collection.getCard(card);
      if (signal.aborted || revision !== detailRevision) return;
      const deckBase = deck.baseUrl ?? new URL('.', deck.manifestUrl).href;
      const isPrimaryDevDeck = dev && (legacyCards || (deck.dev && deck.id === primaryDeckId));
      const body = prepareCardContent(loaded, deckBase, isPrimaryDevDeck ? devBase : undefined);
      content.replaceChildren(body);
      highlight(content);
      detailTitle.textContent = loaded.title;
      detailStatus.textContent = '';
    } catch {
      if (signal.aborted || revision !== detailRevision) return;
      content.replaceChildren();
      detailStatus.textContent = 'This card could not be loaded.';
      retryCard.hidden = false;
    } finally {
      if (!signal.aborted && revision === detailRevision) content.removeAttribute('aria-busy');
    }
  }

  async function syncNav() {
    const revision = ++navigationRevision;
    const routeState = history.getQueryParams();
    query = routeState.q;
    search.value = query;
    updateBrandSize();
    if (!collection) return;
    const current = collection;
    const versioned = current.decks.filter(hasVersionChoice);
    const changes = await Promise.allSettled(
      versioned.map(deck => {
        const requested = routeState.versions.get(deck.id);
        const choice = deck.versions.some(entry => entry.id === requested)
          ? requested
          : deck.defaultVersion;
        return current.setVersion(deck.id, choice);
      }),
    );
    if (signal.aborted || collection !== current || revision !== navigationRevision) return;
    const failed = new Set(
      versioned.filter((_, index) => changes[index].status === 'rejected').map(deck => deck.id),
    );
    versionStatus.textContent = failed.size
      ? 'One or more linked versions could not be loaded.'
      : '';
    let card = routedCard(routeState.c, routeState.d);
    if (failed.has(card?.deckId)) card = undefined;
    if (cardRevision(card) !== cardRevision(selected)) selectCard(card);
    else updateList();
  }

  function onCollectionChange() {
    if (
      filterDecks().some(
        deck => !projectRows.get(deck.id)?.toggle && !collection.isEnabled(deck.id),
      )
    ) {
      renderProjects();
    }
    for (const deck of collection.decks) {
      const scope = versionKey(deck);
      if (versionsShown.get(deck.id) === scope) continue;
      versionsShown.set(deck.id, scope);
      if (deck.offlineAvailable) readOfflineState(deck);
    }
    results.replaceChildren();
    cardButtons.clear();
    updateFilters();
    updateOfflineControls();
    if (selected && !collection.isEnabled(selected.deckId)) {
      selectCard(null, {navigate: true});
    } else if (selected && selected.version !== deckFor(selected)?.version) {
      selectCard(matchingCard(selected), {record: false});
    } else {
      updateList();
    }
  }

  function matchingCard(previous) {
    const cards = collection.listCards().filter(card => card.deckId === previous.deckId);
    return (
      cards.find(card => card.path === previous.path) ??
      (previous.slug && cards.find(card => card.slug === previous.slug))
    );
  }

  async function loadCollection() {
    const revision = ++loadRevision;
    retryLoad.disabled = true;
    loadStatus.textContent = collection?.decks.length
      ? 'Refreshing decks…'
      : `Loading ${qualifyRoutes ? 'decks' : 'deck'}…`;
    const previous = collection;
    let next;
    let failed = 0;
    let retained = 0;
    try {
      if (suppliedCollection) {
        next = suppliedCollection;
      } else if (legacyCards) {
        const legacy = await legacyDeck(legacyCards, {
          pinnedPaths: pinnedCardPaths,
          title: title ?? brand.name ?? 'Deck',
          searchIndexUrl,
        });
        next = composeDecks([legacy]);
      } else {
        const sources = sourceSpecs.length ? sourceSpecs : [primarySource];
        const loaded = await Promise.allSettled(
          sources.map(source => openDeck({offlineStore, ...source})),
        );
        const ready = loaded.flatMap((result, index) => {
          if (result.status === 'fulfilled') return [result.value];
          failed++;
          const source = sources[index];
          const manifest = sourceManifest(source);
          const url = manifest && new URL(manifest, document.baseURI).href;
          const existing = previous?.decks.find(deck => deck.id === (source.id ?? url));
          if (existing) retained++;
          return existing ? [existing] : [];
        });
        next = composeDecks(ready);
      }
    } catch {
      if (signal.aborted || revision !== loadRevision) return;
      loadStatus.textContent = previous?.decks.length
        ? 'Could not refresh decks. Showing the last loaded data.'
        : 'Could not load the deck configuration.';
      retryLoad.disabled = false;
      retryLoad.hidden = false;
      return;
    }

    if (signal.aborted || revision !== loadRevision) return;
    if (previous && previous !== next) {
      await Promise.allSettled(
        next.decks.map(async deck => {
          const old = previous.decks.find(candidate => candidate.id === deck.id);
          if (!old) return;
          next.setEnabled(deck.id, previous.isEnabled(deck.id));
          if (
            old.version !== deck.version &&
            deck.versions?.some(entry => entry.id === old.version)
          ) {
            await next.setVersion(deck.id, old.version);
          }
        }),
      );
      if (signal.aborted || revision !== loadRevision) return;
    }

    unsubscribe?.();
    collection = next;
    unsubscribe = next.subscribe(onCollectionChange);
    if (failed) {
      const decks = qualifyRoutes ? (failed === 1 ? 'one deck' : `${failed} decks`) : 'the deck';
      loadStatus.textContent = retained
        ? `Could not refresh ${decks}. Showing previously loaded data where available.`
        : `Could not load ${decks}.`;
    } else {
      loadStatus.textContent = '';
    }
    retryLoad.disabled = false;
    retryLoad.hidden = !failed;
    updateBrand();
    renderProjects();
    updateFilters();
    versionsShown.clear();
    for (const deck of next.decks) {
      versionsShown.set(deck.id, versionKey(deck));
      if (deck.offlineAvailable) readOfflineState(deck);
    }

    if (previous && selected) {
      const card = matchingCard(selected);
      if (cardRevision(card) !== cardRevision(selected))
        selectCard(card, {navigate: !card, record: false});
      else updateList();
    } else if (navigation) {
      await syncNav();
    } else {
      updateList();
    }
  }

  search.value = query;
  search.addEventListener('input', () => {
    query = search.value;
    limit = pageSize;
    options.open = false;
    openVersionPicker?.menu.hidePopover();
    updateBrandSize();
    if (navigation) history.replaceState({q: query});
    updateList();
  });
  detail.addEventListener('keydown', event => {
    if (event.key === 'Escape' && selected && !event.defaultPrevented) {
      event.preventDefault();
      selectCard(null, {navigate: true, focus: true});
    }
  });
  if (navigation) window.addEventListener('popstate', syncNav, {signal});

  if (serviceWorkerUrl && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register(serviceWorkerUrl).catch(error => {
      console.error('Could not register the Deck service worker:', error);
    });
  }

  async function watchDev() {
    const hmr = await connectHmr({dev, baseUrl: devBase});
    if (signal.aborted) return;
    for (const [name, removed] of [
      ['deck:card-changed', false],
      ['deck:card-removed', true],
    ]) {
      const stop = hmr.on(name, ({path}) => {
        if (legacyCards) {
          const existing = legacyCards.findIndex(card => card.path === path);
          if (existing !== -1) legacyCards.splice(existing, 1);
          if (!removed) legacyCards.push({path, hash: `dev-${loadRevision}`});
        }
        loadCollection();
      });
      signal.addEventListener('abort', stop, {once: true});
    }
  }

  updateBrand();
  if (dev && !suppliedCollection) watchDev();
  await loadCollection();
  return instance;
}
