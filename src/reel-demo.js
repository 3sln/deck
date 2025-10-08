import * as dodo from '@3sln/dodo';
import shadowFactory from '@3sln/bones/shadow';
import { css } from '@3sln/bones/css';
import busFactory from '@3sln/bones/bus';
import observableFactory from '@3sln/bones/observable';
import resizeFactory from '@3sln/bones/resize';

import { Engine, Provider, Query, Action } from '@3sln/ngin';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import githubStyle from 'highlight.js/styles/github.css?inline';
import githubDarkStyle from 'highlight.js/styles/github-dark.css?inline';

const { reconcile, h, div, button, pre, code, span, label, input, p } = dodo;
const { shadow } = shadowFactory({ dodo });
const { ObservableSubject } = busFactory({ dodo });
const { watch, zip, map, dedup } = observableFactory({ dodo });
const { withContainerSize } = resizeFactory({ dodo });

hljs.registerLanguage('javascript', javascript);

function filterSource(text) {
    const regex = /\s*\/\/ reel:ignore:start[\s\S]*?\/\/ reel:ignore:end\s*\n?/gm;
    return text.replace(regex, '');
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
    constructor(initialState) { this.#subject = new ObservableSubject(initialState); }
    get state$() { return this.#subject; }
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

    execute({ state }) {
        state.update(s => ({
            ...s,
            paneVisibility: this.visibility
        }));
    }
}

class PaneVisibility extends Query {
    static deps = ['state'];
    #sub;

    boot({ state }, { notify }) {
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
    constructor(pane) { super(); this.pane = pane; }
    get id() { return this.pane; }
    boot({ state }, { notify }) {
        let lastId = null;
        this.#sub = state.state$.subscribe(s => {
            const newId = s.activePanelIds[this.pane];
            if (newId !== lastId) {
                lastId = newId;
                notify(newId);
            }
        });
    }
    kill() { this.#sub?.unsubscribe(); }
}

class SetActivePanel extends Action {
    static deps = ['state'];
    constructor(pane, id) { super(); this.pane = pane; this.id = id; }
    execute({ state }) {
        state.update((s, pane, id) => ({
            ...s,
            activePanelIds: { ...s.activePanelIds, [pane]: id }
        }), this.pane, this.id);
    }
}

class ActivatePanel extends Action {
    static deps = ['state'];
    constructor(name) { super(); this.name = name; }
    execute({ state }) {
        const currentState = state.state$.value;
        const { panels, paneVisibility } = currentState;
        const panel = panels.get(this.name);
        if (!panel) return;

        let targetPane = panel.pane;
        if (!paneVisibility[targetPane]) {
            targetPane = targetPane === 'left' ? 'right' : 'left';
        }

        if (paneVisibility[targetPane]) {
            state.update(s => ({
                ...s,
                activePanelIds: { ...s.activePanelIds, [targetPane]: this.name }
            }));
        }
    }
}

class AllPropertyNames extends Query {
    static deps = ['state'];
    #sub;
    boot({ state }, { notify }) {
        let lastNames = [];
        this.#sub = state.state$.subscribe(s => {
            const newNames = Object.keys(s.propertySpecs);
            if (newNames.length !== lastNames.length || newNames.some((name, i) => name !== lastNames[i])) {
                lastNames = newNames;
                notify(lastNames);
            }
        });
    }
    kill() { this.#sub?.unsubscribe(); }
}

class PropertySpec extends Query {
    static deps = ['state'];
    #sub;
    constructor(name) {
        super();
        this.name = name;
    }

    boot({ state }, { notify }) {
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

    boot({ state }, { notify }) {
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
    boot({ state }, { notify }) {
        let lastVisible = null;
        this.#sub = state.state$.subscribe(s => {
            const isVisible = Object.keys(s.propertySpecs).length > 0;
            if (isVisible !== lastVisible) {
                lastVisible = isVisible;
                notify(isVisible);
            }
        });
    }
    kill() { this.#sub?.unsubscribe(); }
}

class UpsertProperty extends Action {
    static deps = ['state'];
    constructor(name, options) {
        super();
        this.name = name;
        this.options = options;
    }

    execute({ state }) {
        state.update((s, { name, options }) => {
            const existingSpec = s.propertySpecs[name];
            const newSpecs = { ...s.propertySpecs };
            let newValues = { ...s.propertyValues };

            if (existingSpec && shallowCompare(existingSpec.options, options)) {
                return s; // No change
            }

            newSpecs[name] = { name, options };
            if (!existingSpec) {
                newValues[name] = options.defaultValue;
            }

            return { ...s, propertySpecs: newSpecs, propertyValues: newValues };
        }, { name: this.name, options: this.options });
    }
}

class UpdatePropertyValue extends Action {
    static deps = ['state'];

    constructor(name, value) {
        super();
        this.name = name; this.value = value;
    }
    
    execute({ state }) {
        state.update((s, { name, value }) => ({
            ...s,
            propertyValues: { ...s.propertyValues, [name]: value }
        }), { name: this.name, value: this.value });
    }
}

class Panels extends Query {
    static deps = ['state'];
    #sub;

    boot({ state }, { notify }) {
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

    execute({ state }) {
        state.update((s, panel) => {
            const newPanels = new Map(s.panels);
            const existingPanel = newPanels.get(panel.name);

            if (existingPanel) {
                const updatedPanel = { ...existingPanel, ...panel };
                if (panel.order === undefined) {
                    updatedPanel.order = existingPanel.order;
                }
                newPanels.set(panel.name, updatedPanel);
            } else {
                const newPanel = { ...panel };
                if (newPanel.order === undefined) {
                    const maxOrder = Array.from(newPanels.values()).reduce((max, p) => Math.max(max, p.order || 0), 0);
                    newPanel.order = maxOrder + 1;
                }
                newPanels.set(panel.name, newPanel);
            }
            return { ...s, panels: newPanels };
        }, this.panel);
    }
}

const panelSanitizerInterceptor = {
    deps: ['state'],
    leave: ({ state }) => {
        const currentState = state.state$.value;
        const { panels, activePanelIds, paneVisibility } = currentState;
        const newActivePanelIds = { ...activePanelIds };
        let changed = false;

        const getEffectivePane = (panel) => {
            if (paneVisibility.left && !paneVisibility.right) return 'left';
            if (!paneVisibility.left && paneVisibility.right) return 'right';
            return panel.pane;
        };

        const panelsArray = Array.from(panels.values());

        for (const pane of ['left', 'right']) {
            if (!paneVisibility[pane]) continue;

            const panelsInPane = panelsArray.filter(p => getEffectivePane(p) === pane);
            if (panelsInPane.length === 0) {
                if (newActivePanelIds[pane]) {
                    delete newActivePanelIds[pane];
                    changed = true;
                }
                continue;
            }

            const activeId = newActivePanelIds[pane];
            const activePanelIsInPane = panelsInPane.some(p => p.name === activeId);

            if (!activeId || !activePanelIsInPane) {
                newActivePanelIds[pane] = panelsInPane[0].name;
                changed = true;
            }
        }

        if (changed) {
            state.update(s => ({ ...s, activePanelIds: newActivePanelIds }));
        }
    }
};

const actionLoggerInterceptor = {
    enter: (_, { action }) => {
        console.log(`[ACTION START]`, action);
    },
    leave: (_, { action }) => {
        console.log(`[ACTION END]`, action);
    }
};

const styles = css`
    :host {
        display: block;
        border: 1px solid var(--border-color);
        border-radius: 4px;
        margin-bottom: 1em;
        max-height: 50rem;
        display: flex;
        background-color: var(--card-bg);
    }
    * {
      box-sizing: border-box;
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
        transition: background 0.2s, color 0.2s, opacity 0.2s;
        display: block;
    }
    .tab input[type="radio"] {
        display: none;
    }
    .tab input[type="radio"]:checked + label {
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
      width: auto;
      overflow: auto;
    }
    pre > code {
        padding: 1em;
        margin: 0;
        border-radius: 0;
    }
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
    input[type="text"] {
        background: rgba(0,0,0,0.1);
        border: 1px solid var(--input-border);
        border-radius: 4px;
        padding: 0.5em;
        color: var(--text-color);
    }
    input[type="range"] {
        accent-color: var(--link-color);
    }

    /* Light Theme */
    ${githubStyle}

    /* Dark Theme */
    @media (prefers-color-scheme: dark) {
        ${githubDarkStyle}
    }
`;

class ReelDemo extends HTMLElement {
    #demoDriver = null;
    #engine;
    #sourceCode$ = new ObservableSubject('Loading...');
    #src = null;
    #panelCache = new Map();
    #abortController = new AbortController();

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.adoptedStyleSheets = [styles];
        
        const sourcePanelName = 'Source';
        const propsPanelName = 'Properties';

        const demoState = new DemoState({
            activePanelIds: {},
            propertySpecs: {},
            propertyValues: {},
            panels: new Map(),
            paneVisibility: { left: true, right: true },
        });

        this.#engine = new Engine({
            providers: { state: Provider.fromSingleton(demoState) },
            interceptors: [panelSanitizerInterceptor, actionLoggerInterceptor],
        });

        this.#engine.dispatch(new CreateOrUpdatePanel({
            name: propsPanelName,
            pane: 'right',
            order: 2,
            visibility$: this.#engine.query(new IsPropertiesPanelVisible()),
            render: container => {
                const propIds$ = this.#engine.query(new AllPropertyNames());
                reconcile(container, [
                    watch(propIds$,
                        names => names?.map(
                            name => this.#propertyControl(name).key(name)
                        )
                    )
                ]);
            }
        }));
        this.#engine.dispatch(new CreateOrUpdatePanel({
            name: sourcePanelName,
            pane: 'right',
            order: 1,
            visibility$: new ObservableSubject(true),
            render: container => {
                reconcile(container, [
                    watch(this.#sourceCode$, text => pre(
                        code({ className: 'language-javascript' },
                            filterSource(text))
                            .on({
                                $update: el => {
                                    delete el.dataset.highlighted;
                                    hljs.highlightElement(el);
                                }
                            })
                    )
                    )
                ]);
            }
        }));

        this.#demoDriver = {
            panel: (name, { pane = 'left', order = undefined } = {}) => {
                if (this.#panelCache.has(name)) {
                    return this.#panelCache.get(name);
                }

                const div = document.createElement('div');
                const shadow = div.attachShadow({ mode: 'open' });
                this.#panelCache.set(name, shadow);

                const render = container => {
                  container.replaceChildren(div);
                };
                const panel = {
                    name,
                    pane,
                    render,
                    order,
                    visibility$: new ObservableSubject(true)
                };
                this.#engine.dispatch(new CreateOrUpdatePanel(panel));
                return shadow;
            },
            property: (name, options) => {
                this.#engine.dispatch(new UpsertProperty(name, options));
                return this.#engine.query(new PropertyValue(name));
            },
            setActivePanel: (name) => {
                this.#engine.dispatch(new ActivatePanel(name));
            },
            get signal() {
                return this.#abortController.signal;
            }
        };
    }

    #fetchSource() {
        const src = this.getAttribute('src');
        const canonicalSrc = this.getAttribute('canonical-src') || src;
        if (!src) return;

        fetch(`${canonicalSrc}?raw`)
            .then(res => res.text())
            .then(text => this.#sourceCode$.next(text))
            .catch(err => {
                console.error(`Failed to fetch source for ${src}:`, err);
                this.#sourceCode$.next(`// Failed to load source`);
            });
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue) this.#fetchSource();
    }

    async connectedCallback() {
        this.#fetchSource();
        this.#render();

        this.#src = this.getAttribute('src');
        if (!this.#src) return;

        try {
            const url = new URL(this.#src, location.href);
            url.search += (url.search ? '&' : '') + 'reel-dev-hmr';
            const module = await import(/* @vite-ignore */ url.href);
            module.default(this.#demoDriver);
        } catch (err) {
            console.error(`Failed to load demo module ${this.#src}:`, err);
            const errorPanel = this.#demoDriver.panel('Error', { pane: 'left' });
            reconcile(errorPanel, [
                h('div', { $styling: { color: 'red' } },
                    `Error: Could not load demo module.`)
            ]);
        }
    }

    disconnectedCallback() {
        this.#abortController.abort();
        reconcile(this.shadowRoot, null);
        this.#engine.dispose();
    }

    #render() {
        const renderPane = (pane, panels, activeId) => {
            const sortedPanels = [...panels].sort((a, b) => (a.order || 0) - (b.order || 0));

            return div({ className: 'pane', $styling: { flex: 1 } },
                div({ className: 'tabs' },
                    ...sortedPanels.map(p => {
                        const renderTab = () => div({ className: 'tab' },
                            input({
                                type: 'radio',
                                name: `tabs-${pane}`,
                                id: `tab-${p.name}`,
                                checked: activeId === p.name
                            }),
                            label({
                                for: `tab-${p.name}`
                            }, p.name).on({
                                click: () => this.#engine.dispatch(new SetActivePanel(pane, p.name))
                            })
                        );
                        return watch(p.visibility$, isVisible => isVisible && renderTab());
                    })
                ),
                div({ className: 'content-wrapper' },
                    ...sortedPanels.map(p => {
                        return watch(p.visibility$, isVisible => {
                            if (!isVisible) {
                                return null;
                            }

                            return div({
                                $classes: ['panel-content', activeId === p.name && 'active']
                            })
                            .key(p.name)
                            .opaque()
                            .on({ $update: el => p.render(el) });
                        });
                    })
                )
            );
        };

        const app = withContainerSize(size$ => {
            dedup()(map(s => s && s.width > 768)(size$)).subscribe(isWide => {
                this.#engine.dispatch(new SetPaneVisibility({ left: true, right: isWide }));
            });

            const state$ = zip(
                (panels, leftId, rightId, visibility) => ({
                    panels, leftId, rightId, visibility
                }),
                this.#engine.query(new Panels()),
                this.#engine.query(new ActivePanelForPane('left')),
                this.#engine.query(new ActivePanelForPane('right')),
                this.#engine.query(new PaneVisibility())
            );

            return watch(state$, ({ panels, leftId, rightId, visibility }) => {
                if (!visibility) return null;

                const leftPanels = visibility.left ? panels.filter(p => p.pane === 'left') : [];
                const rightPanels = visibility.right ? panels.filter(p => p.pane === 'right') : [];

                if (leftPanels.length > 0 && rightPanels.length > 0) {
                    return div({ $styling: { display: 'flex', height: '100%', width: '100%' } },
                        renderPane('left', leftPanels, leftId),
                        renderPane('right', rightPanels, rightId)
                    );
                } else if (visibility.left) {
                    return renderPane('left', panels, leftId);
                } else if (visibility.right) {
                    return renderPane('right', panels, rightId);
                }
                return null;
            }, {
              placeholder: () => p('Loading...')
            });
        });

        reconcile(this.shadowRoot, [app]);
    }

    #propertyControl(name) {
        const spec$ = this.#engine.query(new PropertySpec(name));
        return watch(spec$, spec => {
            if (!spec) return null;
            const { name, options } = spec;
            const control = watch(this.#engine.query(new PropertyValue(name)), value => {
                switch (options.type) {
                    case 'range':
                        return input({ type: 'range', min: options.min, max: options.max, value })
                            .on({ input: e => this.#engine.dispatch(new UpdatePropertyValue(name, e.target.valueAsNumber)) });
                    case 'text':
                        return input({ type: 'text', value })
                            .on({ input: e => this.#engine.dispatch(new UpdatePropertyValue(name, e.target.value)) });
                    default:
                        return span('Unknown property type');
                }
            });
            return div({ className: 'property-item' },
                label({ className: 'property-label' }, name),
                control
            );
        });
    }
}

customElements.define('reel-demo', ReelDemo);
