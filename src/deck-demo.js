import * as dodo from '@3sln/dodo';
import styleFactory, {css} from '@3sln/bones/style';
import reactiveFactory from '@3sln/bones/reactive';
import resizeFactory from '@3sln/bones/resize';

import {Engine, Provider, Query, Action} from '@3sln/ngin';
import {stylesheet as highlightStylesheet, highlight} from './highlight.js';

const {reconcile, h, div, button, pre, code, span, label, input, p} = dodo;

const {ObservableSubject, watch, zip, map, dedup} = reactiveFactory({dodo});
const {withContainerSize} = resizeFactory({dodo});

const rootNodeCaches = new WeakMap();
const DISPOSE_DELAY = 3000; // 3 seconds
const HOT = import.meta.hot ? true : false;

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
  }
  .property-label {
    flex: 1;
    text-align: right;
    font-size: 0.9em;
    color: var(--text-color);
    opacity: 0.8;
  }
  .property-item input {
    flex: 2;
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
    clearTimeout(entry.disposeTimeout);
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

  if (entry.refCount === 0) {
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

function propertyControl(engine, name) {
  const spec$ = engine.query(new PropertySpec(name));
  return watch(spec$, spec => {
    if (!spec) return null;
    const {name, options} = spec;
    const control = watch(engine.query(new PropertyValue(name)), value => {
      switch (options?.type ?? 'text') {
        case 'range':
          return input({type: 'range', min: options.min, max: options.max, value}).on({
            input: e => engine.dispatch(new UpdatePropertyValue(name, e.target.valueAsNumber)),
          });
        case 'text':
          return input({type: 'text', value}).on({
            input: e => engine.dispatch(new UpdatePropertyValue(name, e.target.value)),
          });
        default:
          return span('Unknown property type');
      }
    });
    return div({className: 'property-item'}, label({className: 'property-label'}, name), control);
  });
}

function createEngine(src, canonicalSrc) {
  const abortController = new AbortController();
  const sourceCode$ = new ObservableSubject('Loading...');

  const demoState = new DemoState({
    activePanelIds: {},
    propertySpecs: {},
    propertyValues: {},
    panels: new Map(),
    paneVisibility: {left: true, right: true},
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
              code({className: 'language-javascript'}, text).on({
                $update: el => {
                  delete el.dataset.highlighted;
                  highlight(el);
                },
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

    engine.dispatch(
      new CreateOrUpdatePanel({
        name: propsPanelName,
        pane: 'right',
        order: 2,
        render: container => {
          container.adoptedStyleSheets = [commonStyle, propertiesStyle];
          const propIds$ = engine.query(new AllPropertyNames());
          reconcile(container, [
            watch(propIds$, names => names?.map(name => propertyControl(engine, name).key(name))),
          ]);
        },
      }),
    );
  };

  const driver = {
    panel: (name, render, {pane = 'left', order = undefined} = {}) => {
      const panel = {
        name,
        pane,
        render,
        order,
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
    const textSrc = canonicalSrc || src;
    if (!esmSrc || !textSrc) return;

    try {
      if (HOT) {
        const esm = await import(/* @vite-ignore */ `/@deck-dev-esm/${encodeURIComponent(esmSrc)}`);
        const txt = await import(/* @vite-ignore */ `/@deck-dev-src/${encodeURIComponent(textSrc)}.js`);

        const sub = txt.moduleText$.subscribe(text => {
          sourceCode$.next(text);
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
        sourceCode$.next(text);
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
  #subject;

  constructor(initialState) {
    this.#subject = new ObservableSubject(initialState);
  }

  get state$() {
    return this.#subject;
  }

  update(updater, ...args) {
    const currentState = this.#subject.value;
    this.#subject.next(updater(currentState, ...args));
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
    this.#sub = state.state$.subscribe(s => {
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
    this.#sub = state.state$.subscribe(s => {
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

class ActivatePanel extends Action {
  static deps = ['state'];

  constructor(name) {
    super();
    this.name = name;
  }

  execute({state}) {
    const currentState = state.state$.value;
    const {panels, paneVisibility} = currentState;
    const panel = panels.get(this.name);
    if (!panel) return;

    let targetPane = panel.pane;
    if (!paneVisibility[targetPane]) {
      targetPane = targetPane === 'left' ? 'right' : 'left';
    }

    if (paneVisibility[targetPane]) {
      state.update(s => ({
        ...s,
        activePanelIds: {...s.activePanelIds, [targetPane]: this.name},
      }));
    }
  }
}

class AllPropertyNames extends Query {
  static deps = ['state'];
  #sub;

  boot({state}, {notify}) {
    let lastNames = [];
    this.#sub = state.state$.subscribe(s => {
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
    this.#sub = state.state$.subscribe(s => {
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
    this.#sub = state.state$.subscribe(s => {
      const newValue = s.propertyValues[this.name];
      if (newValue !== lastValue) {
        lastValue = newValue;
        notify(newValue);
      }
    });
  }
  kill() {
    this.#sub?.unsubscribe();
  }
}

class IsPropertiesPanelVisible extends Query {
  static deps = ['state'];
  #sub;

  boot({state}, {notify}) {
    let lastVisible = null;
    this.#sub = state.state$.subscribe(s => {
      const isVisible = Object.keys(s.propertySpecs).length > 0;
      if (isVisible !== lastVisible) {
        lastVisible = isVisible;
        notify(isVisible);
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
    this.#sub = state.state$.subscribe(s => {
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
      } else {
        const newPanel = {...panel};
        if (newPanel.order === undefined) {
          const maxOrder = Array.from(newPanels.values()).reduce(
            (max, p) => Math.max(max, p.order || 0),
            0,
          );
          newPanel.order = maxOrder + 1;
        }
        newPanels.set(panel.name, newPanel);

        const newActivePanelIds = s.activePanelIds;
        if (s.paneVisibility[newPanel.pane]) {
          newActivePanelIds[newPanel.pane] = newPanel.name;
        } else {
          const pane = Object.entries(s.paneVisibility).find(([pane, visible]) => visible)?.[0];
          if (pane) {
            newActivePanelIds[pane] = newPanel.name;
          }
        }

        return {
          ...s,
          panels: newPanels,
          activePanelIds: newActivePanelIds,
        };
      }
    }, this.panel);
  }
}

const panelSanitizerInterceptor = {
  deps: ['state'],
  leave: ({state}, {action}) => {
    const currentState = state.state$.value;
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
  }
  .tab label {
    padding: 10px 16px;
    cursor: pointer;
    border-right: 1px solid var(--border-color);
    background: var(--bg-color);
    color: var(--text-color);
    opacity: 0.7;
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
  .panel-content {
    overflow: hidden;
    width: 0px;
    pointer-events: none;
  }
  .panel-content.active {
    pointer-events: auto;
    overflow: auto;
    width: initial;
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

  async connectedCallback() {
    if (!this.id) {
      throw new Error('An id is required for deck-demo');
    }

    this.#id = this.id;
    this.#engine = getEngine(this.getRootNode(), this.id, this.getAttribute('src'), this.getAttribute('canonical-src'));
    this.#render();
  }

  disconnectedCallback() {
    if (!this.#id) {
      return;
    }

    reconcile(this.shadowRoot, null);
    releaseEngine(this.getRootNode(), this.id);
    this.#id = undefined;
    this.#engine = undefined;
  }

  #render() {
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
                id: `tab-${p.name}`,
                checked: activeId === p.name,
              }),
              label(
                {
                  for: `tab-${p.name}`,
                },
                p.name,
              ).on({
                click: () => this.#engine.dispatch(new SetActivePanel(pane, p.name)),
              }),
            ),
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
                $attach: el => {
                  const div = document.createElement('div');
                  const shadow = div.attachShadow({mode: 'open'});
                  const aborter = new AbortController();

                  el.appendChild(div);
                  el._aborter = aborter;
                },
                $update: el => {
                  p.render(el.firstChild.shadowRoot, el._aborter.signal);
                },
                $detach: el => {
                  el._aborter?.abort();
                },
              }),
          ),
        ),
      );
    };

    const app = withContainerSize(size$ => {
      dedup()(map(s => s && s.width > 768)(size$)).subscribe(isWide => {
        this.#engine.dispatch(new SetPaneVisibility({left: true, right: isWide}));
      });

      const state$ = zip(
        (panels, leftId, rightId, visibility) => ({
          panels,
          leftId,
          rightId,
          visibility,
        }),
        this.#engine.query(new Panels()),
        this.#engine.query(new ActivePanelForPane('left')),
        this.#engine.query(new ActivePanelForPane('right')),
        this.#engine.query(new PaneVisibility()),
      );

      return watch(
        state$,
        ({panels, leftId, rightId, visibility}) => {
          if (!visibility) return null;

          const leftPanels = visibility.left ? panels.filter(p => p.pane === 'left') : [];
          const rightPanels = visibility.right ? panels.filter(p => p.pane === 'right') : [];

          if (leftPanels.length > 0 && rightPanels.length > 0) {
            return [
              renderPane('left', leftPanels, leftId),
              renderPane('right', rightPanels, rightId),
            ];
          } else if (visibility.left) {
            return renderPane('left', panels, leftId);
          } else if (visibility.right) {
            return renderPane('right', panels, rightId);
          }
          return null;
        },
        {
          placeholder: () => p('Loading...'),
        },
      );
    });

    reconcile(this.shadowRoot, [app]);
  }
}

customElements.define('deck-demo', DeckDemo);
