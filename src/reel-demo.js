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
                notify(lastId);
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

class AllPropertyIds extends Query {
    static deps = ['state'];
    #sub;
    boot({ state }, { notify }) {
        let lastIds = [];
        this.#sub = state.state$.subscribe(s => {
            const ids = s.properties.map(p => p.id);
            if (ids.length !== lastIds.length || ids.some((id, i) => id !== lastIds[i])) {
                lastIds = ids;
                notify(ids);
            }
        });
    }
    kill() { this.#sub?.unsubscribe(); }
}

class PropertySpec extends Query {
    static deps = ['state'];
    #sub;
    constructor(id) { super(); this.id = id; }
    boot({ state }, { notify }) {
        let lastProp = null;
        this.#sub = state.state$.subscribe(s => {
            const prop = s.properties.find(p => p.id === this.id);
            if (prop?.name !== lastProp?.name || prop?.options !== lastProp?.options) {
                const spec = prop ? { id: prop.id, name: prop.name, options: prop.options } : null;
                lastProp = prop;
                notify(spec);
            }
        });
    }
    kill() { this.#sub?.unsubscribe(); }
}

class PropertyValue extends Query {
    static deps = ['state'];
    #sub;
    constructor(id) { super(); this.id = id; }
    boot({ state }, { notify }) {
        let lastValue = undefined;
        this.#sub = state.state$.subscribe(s => {
            const prop = s.properties.find(p => p.id === this.id);
            const newValue = prop?.value;
            if (newValue !== lastValue) {
                lastValue = newValue;
                notify(newValue);
            }
        });
    }
    kill() { this.#sub?.unsubscribe(); }
}

class IsPropertiesPanelVisible extends Query {
    static deps = ['state'];
    #sub;
    boot({ state }, { notify }) {
        let lastVisible = null;
        this.#sub = state.state$.subscribe(s => {
            const isVisible = s.properties.length > 0;
            if (isVisible !== lastVisible) {
                lastVisible = isVisible;
                notify(isVisible);
            }
        });
    }
    kill() { this.#sub?.unsubscribe(); }
}

class SetProperty extends Action {
    static deps = ['state'];
    constructor(prop) { super(); this.prop = prop; }
    execute({ state }) { state.update((s, prop) => ({ ...s, properties: [...s.properties, prop] }), this.prop); }
}

class UpdateProperty extends Action {
    static deps = ['state'];
    constructor(id, value) { super(); this.id = id; this.value = value; }
    execute({ state }) { state.update((s, id, value) => ({ ...s, properties: s.properties.map(p => p.id === id ? { ...p, value } : p) }), this.id, this.value); }
}

class Panels extends Query {
    static deps = ['state'];
    #sub;
    boot({ state }, { notify }) {
        let lastPanels = null;
        this.#sub = state.state$.subscribe(s => {
            if (s.panels !== lastPanels) {
                lastPanels = s.panels;
                notify(lastPanels);
            }
        });
    }
    kill() { this.#sub?.unsubscribe(); }
}

class CreatePanel extends Action {
    static deps = ['state'];
    constructor(panel) { super(); this.panel = panel; }
    execute({ state }) { state.update((s, panel) => ({ ...s, panels: [...s.panels, panel] }), this.panel); }
}

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
    #idCounter = 0;
    #sourceCode$ = new ObservableSubject('Loading...');

    static #srcLoadSeq = 0;
    static get observedAttributes() { return ['src', 'canonical-src']; } 

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.adoptedStyleSheets = [styles];
        
        const canvasEl = document.createElement('div');
        const canvasId = this.#idCounter++;
        const sourceId = this.#idCounter++;
        const propsId = this.#idCounter++;

        const demoState = new DemoState({
            activePanelIds: { left: canvasId, right: propsId },
            properties: [],
            panels: [
                { id: canvasId, name: 'Canvas', pane: 'left', render: c => c.replaceChildren(canvasEl) },
                { id: sourceId, name: 'Source', pane: 'right', render: c => {
                    reconcile(c, [watch(this.#sourceCode$, text => 
                        pre(code({ className: 'language-javascript' }, filterSource(text)).on({
                            $update: el => { delete el.dataset.highlighted; hljs.highlightElement(el); }
                        }))
                    )]);
                }},
                { id: propsId, name: 'Properties', pane: 'right', render: c => {
                    c.classList.add('properties');
                    const propIds$ = this.#engine.query(new AllPropertyIds());
                    reconcile(c, [watch(propIds$, ids => ids?.map(id => this.#propertyControl(id).key(id)))]);
                }, visibilityQuery: new IsPropertiesPanelVisible() }
            ]
        });

        this.#engine = new Engine({ providers: { state: Provider.fromSingleton(demoState) } });

        this.#demoDriver = {
            dom: canvasEl,
            panel: (name, { pane = 'left' } = {}) => {
                const contentNode = document.createElement('div');
                const panel = { id: this.#idCounter++, name, pane, render: c => c.replaceChildren(contentNode) };
                this.#engine.dispatch(new CreatePanel(panel));
                return contentNode;
            },
            property: (name, options) => {
                const id = this.#idCounter++;
                const prop = { id, name, options };
                this.#engine.dispatch(new SetProperty({ ...prop, value: options.defaultValue }));
                return this.#engine.query(new PropertyValue(id));
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

        const src = this.getAttribute('src');
        try {
            const url = new URL(src, location.href);
            url.searchParams.append('s', ReelDemo.#srcLoadSeq++);

            const demoModule = await import(/* @vite-ignore */ url.toString());
            if (typeof demoModule.default !== 'function') {
                throw new Error('Module does not have a default function export.');
            }
            demoModule.default(this.#demoDriver);
        } catch (err) {
            console.error(`Failed to load demo module from ${src}:`, err);
            reconcile(this.#demoDriver.dom, h('div', { $styling: { color: 'red' } }, `Error: Could not load demo module.`));
        }
    }

    disconnectedCallback() {
        reconcile(this.shadowRoot, null);
        this.#engine.dispose();
    }

    #render() {
        const renderPane = (pane, panels, activeId) => {
            return div({ className: 'pane', $styling: { flex: 1 } },
                div({ className: 'tabs' },
                    ...panels.map(p => {
                        const renderTab = () => div({ className: 'tab' },
                            input({ type: 'radio', name: `tabs-${pane}`, id: `tab-${p.id}`, checked: activeId === p.id }),
                            label({ for: `tab-${p.id}` }, p.name).on({ click: () => this.#engine.dispatch(new SetActivePanel(pane, p.id)) })
                        );
                        return p.visibilityQuery ? watch(this.#engine.query(p.visibilityQuery), isVisible => isVisible && renderTab()) : renderTab();
                    })
                ),
                div({ className: 'content-wrapper' },
                    ...panels.map(p => {
                        const renderContent = () => div({
                          $classes: ['panel-content', activeId === p.id && 'active']
                        }).key(p.id).opaque().on({ $attach: el => p.render(el) });
                        return p.visibilityQuery ? watch(this.#engine.query(p.visibilityQuery), isVisible => isVisible && renderContent()) : renderContent();
                    })
                )
            );
        };

        const app = withContainerSize(size$ => {
            const isWide$ = dedup()(map(s => s && s.width > 768)(size$));

            return watch(isWide$, isWide => {
                const state$ = zip(
                    (panels, leftId, rightId) => ({ panels, leftId, rightId }),
                    this.#engine.query(new Panels()),
                    this.#engine.query(new ActivePanelForPane('left')),
                    this.#engine.query(new ActivePanelForPane('right'))
                );

                return watch(state$, ({ panels, leftId, rightId }) => {
                    if (isWide) {
                        const leftPanels = panels.filter(p => p.pane === 'left');
                        const rightPanels = panels.filter(p => p.pane === 'right');
                        
                        if (rightPanels.length > 0) {
                            return div({ $styling: { display: 'flex', height: '100%', width: '100%' } },
                                renderPane('left', leftPanels, leftId),
                                renderPane('right', rightPanels, rightId)
                            );
                        }
                        return renderPane('left', leftPanels, leftId);
                    } else {
                        return renderPane('left', panels, leftId);
                    }
                }, { placeholder: () => p('Loading...') });
            });
        });

        reconcile(this.shadowRoot, [app]);
    }

    #propertyControl(id) {
        const spec$ = this.#engine.query(new PropertySpec(id));
        return watch(spec$, spec => {
            if (!spec) return null;
            const { name, options } = spec;
            const control = watch(this.#engine.query(new PropertyValue(id)), value => {
                switch (options.type) {
                    case 'range':
                        return input({ type: 'range', min: options.min, max: options.max, value })
                            .on({ input: e => this.#engine.dispatch(new UpdateProperty(id, e.target.valueAsNumber)) });
                    case 'text':
                        return input({ type: 'text', value })
                            .on({ input: e => this.#engine.dispatch(new UpdateProperty(id, e.target.value)) });
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
