import * as dodo from '@3sln/dodo';
import {css} from '@3sln/dodo/style';
import {cell, watch, derive, fromObservable, toObservable} from '@3sln/dodo/reactive';
import {withElementSize} from '@3sln/dodo/observe';

import {Engine, Provider, Query, Action} from '@3sln/ngin';
import {stylesheet as highlightStylesheet, highlight} from './highlight.js';
import {isDev} from './dev-mode.js';

const {reconcile, h, div, pre, code, label, input, p, alias} = dodo;

/** Below this a demo shows one pane at a time rather than side by side. */
const DEMO_WIDE_BREAKPOINT = 768;

// Frozen and shared so the pane-visibility query can compare by identity and
// stay quiet when a resize does not actually change which panes are showing.
const PANES_BOTH = Object.freeze({left: true, right: true});
const PANES_LEFT = Object.freeze({left: true, right: false});

function getLanguageFromPath(path) {
  if (!path) return 'plaintext';
  const extension = path.split('.').pop().toLowerCase();
  switch (extension) {
    case 'js':
    case 'mjs':
      return 'javascript';
    case 'cljs':
    case 'clj':
    case 'cljd':
      return 'clojure';
    case 'css':
      return 'css';
    case 'html':
    case 'xml':
      return 'xml';
    case 'md':
      return 'markdown';
    case 'json':
      return 'json';
    case 'sh':
      return 'bash';
    default:
      return 'plaintext';
  }
}

const rootNodeCaches = new WeakMap();
const DISPOSE_DELAY = 3000; // 3 seconds

const commonStyle = css`
  * {
    box-sizing: border-box;
  }
`;

const propertiesStyle = css`
  .properties {
    display: flex;
    flex-direction: column;
    flex-wrap: wrap;
    gap: 0 2em;
    overflow-x: auto;
  }
  .property-item {
    display: flex;
    align-items: center;
    gap: 1em;
    margin-bottom: 0.75em;
    width: 250px;
    color: var(--text-color);
  }
  .property-item input {
    flex-grow: 0;
  }
  input[type='text'] {
    background: rgba(0, 0, 0, 0.1);
    border: 1px solid var(--input-border);
    border-radius: 4px;
    padding: 0.5em;
    color: var(--text-color);
  }
  input[type='range'] {
    accent-color: var(--link-color);
  }
`;

function getEngine(rootNode, key, src, canonicalSrc) {
  if (!rootNodeCaches.has(rootNode)) {
    rootNodeCaches.set(rootNode, new Map());
  }
  const cache = rootNodeCaches.get(rootNode);

  if (cache.has(key)) {
    const entry = cache.get(key);
    if (entry.disposeTimeout !== null) {
      clearTimeout(entry.disposeTimeout);
      entry.disposeTimeout = null;
    }
    entry.refCount++;
    return entry.engine;
  }

  const {engine, abortController} = createEngine(src, canonicalSrc);
  const entry = {
    engine,
    refCount: 1,
    disposeTimeout: null,
    abortController: abortController,
  };
  cache.set(key, entry);
  return engine;
}

function releaseEngine(rootNode, key) {
  const cache = rootNodeCaches.get(rootNode);
  if (!cache || !cache.has(key)) {
    return;
  }

  const entry = cache.get(key);
  entry.refCount--;

  if (entry.refCount === 0 && entry.disposeTimeout === null) {
    entry.disposeTimeout = setTimeout(() => {
      entry.disposeTimeout = null;
      if (entry.refCount > 0) {
        return;
      }

      entry.engine.dispose();
      entry.abortController.abort();
      cache.delete(key);
    }, DISPOSE_DELAY);
  }
}

/**
 * One property row.
 *
 * An `alias` rather than a plain function because its body realises two ngin
 * queries: called on every render it would boot and kill a fresh controller per
 * keystroke. `alias` re-runs only when its arguments change, and they never do.
 */
const propertyControl = alias((engine, name) => {
  const state$ = derive(
    [
      fromObservable(engine.query(new PropertySpec(name))),
      fromObservable(engine.query(new PropertyValue(name))),
    ],
    (spec, value) => ({spec, value}),
  );

  return watch(state$, ({spec, value}) => {
    if (!spec) return null;
    const {options} = spec;
    const onInput = read => e => engine.dispatch(new UpdatePropertyValue(name, read(e.target)));

    let control;
    switch (options?.type ?? 'text') {
      case 'range':
        control = input({type: 'range', min: options.min, max: options.max, value}).on({
          input: onInput(target => target.valueAsNumber),
        });
        break;
      case 'checkbox':
        control = input({type: 'checkbox', checked: !!value}).on({
          input: onInput(target => target.checked),
        });
        break;
      default:
        control = input({type: options?.type ?? 'text', value: value ?? ''}).on({
          input: onInput(target => target.value),
        });
    }

    return label({className: 'property-item'}, name, control);
  });
});

function createEngine(src, canonicalSrc) {
  const abortController = new AbortController();
  const sourceCode$ = cell('Loading...');
  const textSrc = canonicalSrc || src;
  const lang = getLanguageFromPath(textSrc);

  const demoState = new DemoState({
    activePanelIds: {},
    propertySpecs: {},
    propertyValues: {},
    panels: new Map(),
    paneVisibility: PANES_BOTH,
  });

  const engine = new Engine({
    providers: {state: Provider.fromSingleton(demoState)},
    interceptors: [panelSanitizerInterceptor, actionLoggerInterceptor],
  });

  const sourcePanelName = 'Source';
  const propsPanelName = 'Properties';

  engine.dispatch(
    new CreateOrUpdatePanel({
      name: sourcePanelName,
      pane: 'right',
      order: 1,
      render: container => {
        container.adoptedStyleSheets = [commonStyle, highlightStylesheet];

        reconcile(container, [
          watch(sourceCode$, text =>
            pre(
              code({className: `language-${lang}`}, text).on({
                $update: el => highlight(el),
              }),
            ),
          ),
        ]);
      },
    }),
  );

  let propertyPanelCreated = false;
  const ensurePropertyPanel = () => {
    if (propertyPanelCreated) {
      return;
    }

    propertyPanelCreated = true;

    engine.dispatch(
      new CreateOrUpdatePanel({
        name: propsPanelName,
        pane: 'right',
        order: 2,
        render: container => {
          container.adoptedStyleSheets = [commonStyle, propertiesStyle];
          const propIds$ = fromObservable(engine.query(new AllPropertyNames()), {initial: []});
          reconcile(container, [
            watch(propIds$, names =>
              div(
                {className: 'properties'},
                ...(names ?? []).map(name => propertyControl(engine, name).key(name)),
              ),
            ),
          ]);
        },
      }),
    );
  };

  const driver = {
    panel: (
      name,
      render,
      {pane = 'left', order = undefined, mode = 'shadow', colorScheme = undefined} = {},
    ) => {
      const panel = {
        name,
        pane,
        render,
        order,
        mode,
        colorScheme,
      };
      engine.dispatch(new CreateOrUpdatePanel(panel));
    },
    property: (name, options) => {
      ensurePropertyPanel();
      engine.dispatch(new UpsertProperty(name, options));
      return engine.query(new PropertyValue(name));
    },
    get signal() {
      return abortController.signal;
    },
  };

  (async () => {
    const esmSrc = src;
    if (!esmSrc || !textSrc) return;

    try {
      // The dev server serves two generated modules per demo — the module
      // proxy and its source text — in whichever dialect it speaks. A
      // production build has neither, and imports the real thing.
      if (isDev()) {
        const esm = await import(/* @vite-ignore */ `/@deck-dev-esm/${encodeURIComponent(esmSrc)}`);
        const txt = await import(
          /* @vite-ignore */ `/@deck-dev-src/${encodeURIComponent(textSrc)}`
        );

        const sub = txt.moduleText$.subscribe(text => {
          sourceCode$.setValue(text);
        });
        abortController.signal.addEventListener('abort', () => {
          sub.unsubscribe();
        });
        esm.default(driver);
      } else {
        const esmUrl = new URL(esmSrc, location.href);
        const textUrl = new URL(textSrc, location.href);
        const m = await import(/* @vite-ignore */ esmUrl.href);
        m.default(driver);

        const text = await fetch(textUrl).then(r => r.text());
        sourceCode$.setValue(text);
      }
    } catch (err) {
      console.error(`Failed to load demo module ${src}:`, err);
      driver.panel('Error', container => {
        reconcile(container, [
          h('div', {$styling: {color: 'red'}}, `Error: Could not load demo module.`),
        ]);
      });
    }
  })();

  return {engine, abortController};
}

function shallowCompare(objA, objB) {
  if (objA === objB) return true;
  if (!objA || !objB) return false;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (objA[key] !== objB[key]) return false;
  }
  return true;
}

// --- Reactive Store for Demo State ---
class DemoState {
  #cell;
  #observable;

  constructor(initialState) {
    this.#cell = cell(initialState);
    this.#observable = toObservable(this.#cell);
  }

  get value() {
    return this.#cell.getValue();
  }

  subscribe(observerOrNext) {
    return this.#observable.subscribe(observerOrNext);
  }

  update(updater, ...args) {
    this.#cell.setValue(updater(this.#cell.getValue(), ...args));
  }
}

// --- Ngin State Definitions ---

class SetPaneVisibility extends Action {
  static deps = ['state'];

  constructor(visibility) {
    super();
    this.visibility = visibility;
  }

  execute({state}) {
    if (state.value.paneVisibility === this.visibility) return;
    state.update(s => ({
      ...s,
      paneVisibility: this.visibility,
    }));
  }
}

class PaneVisibility extends Query {
  static deps = ['state'];
  #sub;

  boot({state}, {notify}) {
    let lastVisibility = null;
    this.#sub = state.subscribe(s => {
      if (s.paneVisibility !== lastVisibility) {
        lastVisibility = s.paneVisibility;
        notify(lastVisibility);
      }
    });
  }

  kill() {
    this.#sub?.unsubscribe();
  }
}

class ActivePanelForPane extends Query {
  static deps = ['state'];
  #sub;

  constructor(pane) {
    super();
    this.pane = pane;
  }

  boot({state}, {notify}) {
    let lastId = null;
    this.#sub = state.subscribe(s => {
      const newId = s.activePanelIds[this.pane];
      if (newId !== lastId) {
        lastId = newId;
        notify(newId);
      }
    });
  }

  kill() {
    this.#sub?.unsubscribe();
  }
}

class SetActivePanel extends Action {
  static deps = ['state'];

  constructor(pane, id) {
    super();
    this.pane = pane;
    this.id = id;
  }

  execute({state}) {
    state.update(
      (s, pane, id) => ({
        ...s,
        activePanelIds: {...s.activePanelIds, [pane]: id},
      }),
      this.pane,
      this.id,
    );
  }
}

class AllPropertyNames extends Query {
  static deps = ['state'];
  #sub;

  boot({state}, {notify}) {
    let lastNames = [];
    this.#sub = state.subscribe(s => {
      const newNames = Object.keys(s.propertySpecs);
      if (
        newNames.length !== lastNames.length ||
        newNames.some((name, i) => name !== lastNames[i])
      ) {
        lastNames = newNames;
        notify(lastNames);
      }
    });
  }
  kill() {
    this.#sub?.unsubscribe();
  }
}

class PropertySpec extends Query {
  static deps = ['state'];
  #sub;

  constructor(name) {
    super();
    this.name = name;
  }

  boot({state}, {notify}) {
    let lastSpec = null;
    this.#sub = state.subscribe(s => {
      const newSpec = s.propertySpecs[this.name];
      if (!shallowCompare(newSpec, lastSpec)) {
        lastSpec = newSpec;
        notify(newSpec);
      }
    });
  }
  kill() {
    this.#sub?.unsubscribe();
  }
}

class PropertyValue extends Query {
  static deps = ['state'];
  #sub;

  constructor(name) {
    super();
    this.name = name;
  }

  boot({state}, {notify}) {
    let lastValue = undefined;
    let emitted = false;
    this.#sub = state.subscribe(s => {
      const newValue = s.propertyValues[this.name];
      if (!emitted || newValue !== lastValue) {
        emitted = true;
        lastValue = newValue;
        notify(newValue);
      }
    });
  }
  kill() {
    this.#sub?.unsubscribe();
  }
}

class UpsertProperty extends Action {
  static deps = ['state'];

  constructor(name, options) {
    super();
    this.name = name;
    this.options = options;
  }

  execute({state}) {
    state.update(
      (s, {name, options}) => {
        const existingSpec = s.propertySpecs[name];
        const newSpecs = {...s.propertySpecs};
        let newValues = {...s.propertyValues};

        if (existingSpec && shallowCompare(existingSpec.options, options)) {
          return s; // No change
        }

        newSpecs[name] = {name, options};

        if (!existingSpec) {
          newValues[name] = options?.defaultValue;
        }
        return {...s, propertySpecs: newSpecs, propertyValues: newValues};
      },
      {name: this.name, options: this.options},
    );
  }
}

class UpdatePropertyValue extends Action {
  static deps = ['state'];

  constructor(name, value) {
    super();
    this.name = name;
    this.value = value;
  }

  execute({state}) {
    state.update(
      (s, {name, value}) => ({
        ...s,
        propertyValues: {...s.propertyValues, [name]: value},
      }),
      {name: this.name, value: this.value},
    );
  }
}

class Panels extends Query {
  static deps = ['state'];
  #sub;

  boot({state}, {notify}) {
    let lastPanels = null;
    this.#sub = state.subscribe(s => {
      if (s.panels !== lastPanels) {
        lastPanels = s.panels;
        notify(Array.from(lastPanels.values()));
      }
    });
  }

  kill() {
    this.#sub?.unsubscribe();
  }
}

class CreateOrUpdatePanel extends Action {
  static deps = ['state'];

  constructor(panel) {
    super();
    this.panel = panel;
  }

  execute({state}) {
    state.update((s, panel) => {
      const newPanels = new Map(s.panels);
      const existingPanel = newPanels.get(panel.name);

      if (existingPanel) {
        const updatedPanel = {...existingPanel, ...panel};
        if (panel.order === undefined) {
          updatedPanel.order = existingPanel.order;
        }
        newPanels.set(panel.name, updatedPanel);
        return {...s, panels: newPanels};
      }

      const newPanel = {...panel};
      if (newPanel.order === undefined) {
        const maxOrder = Array.from(newPanels.values()).reduce(
          (max, p) => Math.max(max, p.order || 0),
          0,
        );
        newPanel.order = maxOrder + 1;
      }
      newPanels.set(panel.name, newPanel);

      // A copy: mutating the current state's map in place makes the change
      // invisible to anything comparing old against new, which is every query
      // in this file.
      const newActivePanelIds = {...s.activePanelIds};
      const pane = s.paneVisibility[newPanel.pane]
        ? newPanel.pane
        : Object.entries(s.paneVisibility).find(([, visible]) => visible)?.[0];
      if (pane) {
        newActivePanelIds[pane] = newPanel.name;
      }

      return {
        ...s,
        panels: newPanels,
        activePanelIds: newActivePanelIds,
      };
    }, this.panel);
  }
}

const panelSanitizerInterceptor = {
  deps: ['state'],
  leave: ({state}) => {
    const currentState = state.value;
    const {panels, activePanelIds, paneVisibility} = currentState;
    const newActivePanelIds = {...activePanelIds};
    let changed = false;

    const getEffectivePane = panel => {
      if (paneVisibility.left && !paneVisibility.right) return 'left';
      if (!paneVisibility.left && paneVisibility.right) return 'right';
      return panel.pane;
    };

    const panelsArray = Array.from(panels.values());

    for (const pane of ['left', 'right']) {
      if (!paneVisibility[pane]) continue;

      const panelsInPane = panelsArray.filter(p => getEffectivePane(p) === pane);
      const activeId = newActivePanelIds[pane];
      const activePanelIsInPane = panelsInPane.some(p => p.name === activeId);

      if (!activeId || !activePanelIsInPane) {
        newActivePanelIds[pane] = panelsInPane[panelsInPane.length - 1]?.name;
        changed = true;
      }
    }

    if (changed) {
      state.update(s => ({...s, activePanelIds: newActivePanelIds}));
    }
  },
};

const actionLoggerInterceptor = {
  error: (_, {action, error}) => {
    console.error(action, error);
  },
};

const demoStyle = css`
  :host {
    display: flex;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    margin-bottom: 1em;
    max-height: 50rem;
    background-color: var(--card-bg);
  }
  .pane {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border-color);
    min-width: 0;
  }
  .pane:last-child {
    border-right: none;
  }
  .tabs {
    display: flex;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
    overflow-x: auto;
  }
  .tab label {
    padding: 10px 16px;
    cursor: pointer;
    border-right: 1px solid var(--border-color);
    background: var(--bg-color);
    color: var(--text-color);
    opacity: 0.7;
    white-space: nowrap;
    transition:
      background 0.2s,
      color 0.2s,
      opacity 0.2s;
    display: block;
  }
  .tab input[type='radio'] {
    display: none;
  }
  .tab input[type='radio']:checked + label {
    background: var(--card-bg);
    color: var(--text-color);
    opacity: 1;
    border-bottom: 1px solid var(--card-bg);
    margin-bottom: -1px;
  }
  .tab label:hover {
    background: var(--card-hover-bg);
    opacity: 1;
  }
  .content-wrapper {
    display: flex;
    flex-grow: 1;
    overflow: hidden;
    padding: 1rem;
  }
  /*
   * Inactive panels are display:none, not width:0.
   *
   * A zero-width panel is still laid out, and its content wraps into a column
   * one character wide — so a Source panel holding a hundred lines of code
   * became thousands of pixels tall, and the demo, being a flex row, took the
   * tallest panel's height. A one-line counter demo rendered 800px tall
   * (its max-height, which is what stopped it being worse) with the content
   * pinned to the top. display:none keeps the element and its state and skips
   * the layout, which is the whole of what was wanted.
   */
  .panel-content {
    display: none;
  }
  .panel-content.active {
    display: block;
    overflow: auto;
    width: 100%;
  }
  pre > code {
    padding: 1em;
    margin: 0;
    border-radius: 0;
  }
`;

class DeckDemo extends HTMLElement {
  #engine;
  #id;

  constructor() {
    super();
    this.attachShadow({mode: 'open'});
    this.shadowRoot.adoptedStyleSheets = [commonStyle, demoStyle];
  }

  connectedCallback() {
    if (!this.id) {
      // Throwing here would take out whatever is upgrading the element, which
      // in a card body is every element after this one.
      console.error('Deck: <deck-demo> needs an id; ignoring this one.', this);
      return;
    }

    this.#id = this.id;
    this.#engine = getEngine(
      this.getRootNode(),
      this.#id,
      this.getAttribute('src'),
      this.getAttribute('canonical-src'),
    );
    this.#render();
  }

  disconnectedCallback() {
    if (!this.#id) {
      return;
    }

    reconcile(this.shadowRoot, null);
    releaseEngine(this.getRootNode(), this.#id);
    this.#id = undefined;
    this.#engine = undefined;
  }

  #render() {
    const engine = this.#engine;

    const renderPane = (pane, panels, activeId) => {
      const sortedPanels = [...panels].sort((a, b) => (a.order || 0) - (b.order || 0));

      return div(
        {className: 'pane', $styling: {flex: 1}},
        div(
          {className: 'tabs'},
          ...sortedPanels.map(p =>
            div(
              {className: 'tab'},
              input({
                type: 'radio',
                name: `tabs-${pane}`,
                id: `tab-${pane}-${p.name}`,
                checked: activeId === p.name,
              }),
              label({for: `tab-${pane}-${p.name}`}, p.name).on({
                click: () => engine.dispatch(new SetActivePanel(pane, p.name)),
              }),
            ).key(p.name),
          ),
        ),
        div(
          {className: 'content-wrapper'},
          ...sortedPanels.map(p =>
            div({
              $classes: ['panel-content', activeId === p.name && 'active'],
            })
              .key(p.name)
              .opaque()
              .on({
                $update: el => {
                  if (p.render === el._renderer) {
                    return;
                  }

                  el._aborter?.abort();
                  const aborter = new AbortController();
                  el._aborter = aborter;
                  el._renderer = p.render;

                  if (p.mode === 'iframe') {
                    const iframe = document.createElement('iframe');
                    iframe.style.cssText =
                      'border: none; width: 100%; height: 100%; display: block;';

                    iframe.onload = () => {
                      const doc = iframe.contentDocument;
                      if (!doc) return;

                      if (p.colorScheme) {
                        doc.documentElement.style.colorScheme = p.colorScheme;
                      }
                      doc.body.style.margin = '0';

                      p.render(doc.body, aborter.signal);
                    };
                    el.replaceChildren(iframe);
                  } else {
                    const host = document.createElement('div');
                    const shadow = host.attachShadow({mode: 'open'});
                    el.replaceChildren(host);
                    p.render(shadow, aborter.signal);
                  }
                },
                $detach: el => {
                  el._aborter?.abort();
                },
              }),
          ),
        ),
      );
    };

    const state$ = derive(
      [
        fromObservable(engine.query(new Panels()), {initial: []}),
        fromObservable(engine.query(new ActivePanelForPane('left'))),
        fromObservable(engine.query(new ActivePanelForPane('right'))),
        fromObservable(engine.query(new PaneVisibility())),
      ],
      (panels, leftId, rightId, visibility) => ({panels, leftId, rightId, visibility}),
    );

    const renderState = ({panels, leftId, rightId, visibility}) => {
      if (!visibility) return null;

      const leftPanels = visibility.left ? panels.filter(p => p.pane === 'left') : [];
      const rightPanels = visibility.right ? panels.filter(p => p.pane === 'right') : [];

      if (leftPanels.length > 0 && rightPanels.length > 0) {
        return [renderPane('left', leftPanels, leftId), renderPane('right', rightPanels, rightId)];
      }
      if (visibility.left) {
        return renderPane('left', panels, leftId);
      }
      if (visibility.right) {
        return renderPane('right', panels, rightId);
      }
      return null;
    };

    const watchOptions = {placeholder: () => p('Loading...')};

    // The demo collapses to one pane on a narrow screen. Dispatching only on a
    // crossing keeps a resize from looping through the store on every frame.
    let lastWide = null;
    const app = withElementSize(({width}) => {
      const wide = width > DEMO_WIDE_BREAKPOINT;
      if (wide !== lastWide) {
        lastWide = wide;
        engine.dispatch(new SetPaneVisibility(wide ? PANES_BOTH : PANES_LEFT));
      }
      return watch(state$, renderState, watchOptions);
    });

    reconcile(this.shadowRoot, [app]);
  }
}

customElements.define('deck-demo', DeckDemo);
