import * as dodo from '@3sln/dodo';
import shadowFactory from '@3sln/bones/shadow.js';
import { css } from '@3sln/bones/css.js';
import busFactory from '@3sln/bones/bus.js';
import observableFactory from '@3sln/bones/observable.js';
import { Engine, Provider, Query, Action } from '@3sln/ngin';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import githubStyle from 'highlight.js/styles/github.css?inline';

const { reconcile, h, div, button, pre, code, span, label, input, p } = dodo;
const { shadow } = shadowFactory({ dodo });
const { ObservableSubject } = busFactory({ dodo });
const { watch, zip } = observableFactory({ dodo });

hljs.registerLanguage('javascript', javascript);

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
        const newState = updater(currentState, ...args);
        this.#subject.next(newState);
    }
}

// --- Ngin State Definitions ---

class ActivePanel extends Query {
    static deps = ['state'];
    boot({ state }, { notify }) {
        let lastId = null;
        state.state$.subscribe({
            next: (s) => {
                if (s.activePanelId !== lastId) {
                    lastId = s.activePanelId;
                    notify(lastId);
                }
            }
        });
    }
}

class SetActivePanel extends Action {
    static deps = ['state'];
    constructor(id) {
        super();
        this.id = id;
    }
    execute({ state }) {
        state.update((s, id) => ({ ...s, activePanelId: id }), this.id);
    }
}

class AllProperties extends Query {
    static deps = ['state'];
    boot({ state }, { notify }) {
        let lastProps = null;
        state.state$.subscribe({
            next: (s) => {
                if (s.properties !== lastProps) {
                    lastProps = s.properties;
                    notify(lastProps);
                }
            }
        });
    }
}

class IsPropertiesPanelVisible extends Query {
    static deps = ['state'];
    boot({ state }, { notify }) {
        state.state$.subscribe({
            next: (s) => notify(s.properties.length > 0)
        });
    }
}

class Property extends Query {
    static deps = ['state'];
    constructor(id) {
        super();
        this.id = id;
    }
    boot({ state }, { notify }) {
        let lastValue = undefined;
        state.state$.subscribe({
            next: (s) => {
                const prop = s.properties.find(p => p.id === this.id);
                const newValue = prop?.value;
                if (newValue !== lastValue) {
                    lastValue = newValue;
                    notify(newValue);
                }
            }
        });
    }
}

class SetProperty extends Action {
    static deps = ['state'];
    constructor(prop) {
        super();
        this.prop = prop;
    }
    execute({ state }) {
        state.update((s, prop) => ({ 
            ...s, 
            properties: [...s.properties, prop] 
        }), this.prop);
    }
}

class UpdateProperty extends Action {
    static deps = ['state'];
    constructor(id, value) {
        super();
        this.id = id;
        this.value = value;
    }
    execute({ state }) {
        state.update((s, id, value) => ({ 
            ...s, 
            properties: s.properties.map(p => p.id === id ? { ...p, value } : p)
        }), this.id, this.value);
    }
}

class Panels extends Query {
    static deps = ['state'];
    boot({ state }, { notify }) {
        let lastPanels = null;
        state.state$.subscribe({
            next: (s) => {
                if (s.panels !== lastPanels) {
                    lastPanels = s.panels;
                    notify(lastPanels);
                }
            }
        });
    }
}

class CreatePanel extends Action {
    static deps = ['state'];
    constructor(panel) {
        super();
        this.panel = panel;
    }
    execute({ state }) {
        state.update((s, panel) => ({ ...s, panels: [...s.panels, panel] }), this.panel);
    }
}

const styles = css`
    :host {
        display: block;
        border: 1px solid #ccc;
        border-radius: 4px;
        margin-bottom: 1em;
        max-height: 600px;
        display: flex;
        flex-direction: column;
    }
    .tabs {
        display: flex;
        border-bottom: 1px solid #ccc;
        flex-shrink: 0;
    }
    .tab label {
        padding: 10px 16px;
        cursor: pointer;
        border-right: 1px solid #ccc;
        background: #f0f0f0;
        color: #666;
        transition: background 0.2s, color 0.2s;
        display: block;
    }
    .tab input[type="radio"] {
        display: none;
    }
    .tab input[type="radio"]:checked + label {
        background: #fff;
        color: #000;
        border-bottom: 1px solid #fff;
        margin-bottom: -1px;
    }
    .tab label:hover {
        background: #e9e9e9;
    }
    .content-wrapper {
        display: flex;
        flex-grow: 1;
        overflow: hidden;
    }
    .panel.active {
        flex-grow: 1;
        padding: 1em;
        overflow: hidden;
    }
    .panel {
        flex-grow: 0;
        width: 0;
        max-height: 50rem;
        overflow: auto;
    }
    pre > code {
        padding: 1em;
        margin: 0;
        border-radius: 0;
    }
    ${githubStyle}
`;

class ReelDemo extends HTMLElement {
    #demoDriver = null;
    #engine;
    #idCounter = 0;
    #sourceCode$ = new ObservableSubject('Loading...');

    static get observedAttributes() {
        return ['src', 'canonical-src'];
    }

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.adoptedStyleSheets = [styles];
        
        const canvasEl = document.createElement('div');
        const canvasId = this.#idCounter++;
        const sourceId = this.#idCounter++;
        const propsId = this.#idCounter++;

        const demoState = new DemoState({
            activePanelId: canvasId,
            properties: [],
            panels: [
                { 
                    id: canvasId,
                    name: 'Canvas', 
                    render: (container) => container.replaceChildren(canvasEl)
                },
                { 
                    id: sourceId,
                    name: 'Source', 
                    render: (container) => {
                        reconcile(container, [
                            watch(this.#sourceCode$, text => 
                                pre(code({ className: 'language-javascript' }, text).on({ 
                                    $update: (el) => { 
                                        delete el.dataset.highlighted; 
                                        hljs.highlightElement(el); 
                                    }
                                }))
                            )
                        ]);
                    }
                },
                {
                    id: propsId,
                    name: 'Properties',
                    render: (container) => {
                        const props$ = this.#engine.query(new AllProperties());
                        reconcile(container, [watch(props$, props => props?.map(p => this.#renderProperty(p)))]);
                    },
                    visibilityQuery: new IsPropertiesPanelVisible()
                }
            ]
        });

        this.#engine = new Engine({
            providers: {
                state: Provider.fromSingleton(demoState)
            }
        });

        this.#demoDriver = {
            dom: canvasEl,
            panel: (name) => {
                const contentNode = document.createElement('div');
                const panel = {
                    id: this.#idCounter++,
                    name,
                    render: (container) => container.replaceChildren(contentNode)
                };
                this.#engine.dispatch(new CreatePanel(panel));
                return contentNode;
            },
            property: (name, options) => {
                const id = this.#idCounter++;
                const prop = { id, name, options };
                this.#engine.dispatch(new SetProperty({ ...prop, value: options.defaultValue }));
                return this.#engine.query(new Property(id));
            }
        };
    }

    #fetchSource() {
        const src = this.getAttribute('src');
        const canonicalSrc = this.getAttribute('canonical-src') || src;
        if (!src) return;

        fetch(`${canonicalSrc}?raw`)
            .then(res => res.text())
            .then(text => {
                this.#sourceCode$.next(text);
            })
            .catch(err => {
                console.error(`Failed to fetch source for ${src}:`, err);
                this.#sourceCode$.next(`// Failed to load source`);
            });
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue !== newValue) {
            this.#fetchSource();
        }
    }

    async connectedCallback() {
        this.#fetchSource();
        this.#render();

        const src = this.getAttribute('src');
        try {
            const demoModule = await import(/* @vite-ignore */ src);
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
        this.#engine.dispose();
    }

    #render() {
        const state$ = zip(
            (activePanelId, panels) => ({ activePanelId, panels }),
            this.#engine.query(new ActivePanel()),
            this.#engine.query(new Panels())
        );

        const app = watch(state$, ({ activePanelId, panels }) => {
            const renderTab = (p) => div({ className: 'tab' },
                input({ type: 'radio', name: 'tabs', id: `tab-${p.id}`, checked: activePanelId === p.id }),
                label({ for: `tab-${p.id}` }, p.name).on({ click: () => this.#engine.dispatch(new SetActivePanel(p.id)) })
            );

            const renderPanelContent = (p, visible) => div({
                $classes: ['panel', activePanelId === p.id && visible && 'active']
            }).key(p.id).opaque().on({
                $attach: el => p.render(el)
            });

            return [
                div({ className: 'tabs' },
                    ...panels.map(p => {
                        if (p.visibilityQuery) {
                            return watch(this.#engine.query(p.visibilityQuery), isVisible => isVisible && renderTab(p));
                        } else {
                            return renderTab(p);
                        }
                    })
                ),
                div({ className: 'content-wrapper' },
                    ...panels.map(p => {
                        if (p.visibilityQuery) {
                            return watch(this.#engine.query(p.visibilityQuery), isVisible => renderPanelContent(p, isVisible));
                        } else {
                            return renderPanelContent(p, true);
                        }
                    })
                )
            ];
        }, {
            placeholder: () => p('Loading...')
        });

        reconcile(this.shadowRoot, [app]);
    }

    #renderProperty(prop) {
        const { id, name, options } = prop;
        
        const control = watch(this.#engine.query(new Property(id)), value => {
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

        return div({ $styling: { marginBottom: '0.5em' } },
            label(name),
            control
        );
    }
}

customElements.define('reel-demo', ReelDemo);
