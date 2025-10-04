import * as dodo from '@3sln/dodo';
import shadowFactory from '@3sln/bones/shadow.js';
import { css } from '@3sln/bones/css.js';
import busFactory from '@3sln/bones/bus.js';
import observableFactory from '@3sln/bones/observable.js';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import githubStyle from 'highlight.js/styles/github.css?inline';

const { reconcile, h, div, button, pre, code, span, label, input } = dodo;
const { shadow } = shadowFactory({ dodo });
const { ObservableSubject } = busFactory({ dodo });
const { watch } = observableFactory({ dodo });

hljs.registerLanguage('javascript', javascript);

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
    .panel {
        width: 0;
        overflow: hidden;
        padding: 0;
    }
    .panel.active {
        width: 100%;
        overflow-y: auto;
        overflow-x: auto;
        padding: 1em;
    }
    .source pre {
        margin: 0;
    }
    .source code.hljs {
        padding: 1em;
        border-radius: 0;
    }
    ${githubStyle}
`;

class ReelDemo extends HTMLElement {
    #state = { sourceCode: 'Loading...', properties: {} };
    #activeTab$ = new ObservableSubject('Canvas');
    #panels$ = new ObservableSubject([]);
    #demoDriver = null;
    #canvasEl = document.createElement('div');
    #propsEl = document.createElement('div');
    #sourceEl = document.createElement('div');

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.adoptedStyleSheets = [styles];
        this.#canvasEl.className = 'panel canvas';
        this.#propsEl.className = 'panel properties';
        this.#sourceEl.className = 'panel source';
    }

    async connectedCallback() {
        const src = this.getAttribute('src');
        const canonicalSrc = this.getAttribute('canonical-src') || src;

        if (!src) {
            this.shadowRoot.innerHTML = 'Error: No src attribute provided.';
            return;
        }

        try {
            fetch(`${canonicalSrc}?raw`)
                .then(res => res.text())
                .then(text => {
                    this.#state.sourceCode = text;
                    this.#render();
                });

            const demoModule = await import(/* @vite-ignore */ src);

            if (typeof demoModule.default !== 'function') {
                throw new Error('Module does not have a default function export.');
            }

            this.#createDemoDriver();
            this.#render();
            demoModule.default(this.#demoDriver);

        } catch (err) {
            console.error(`Failed to load demo module from ${src}:`, err);
            this.shadowRoot.innerHTML = `Error: Could not load demo module.`;
        }
    }

    #createDemoDriver() {
        this.#demoDriver = {
            dom: this.#canvasEl,
            panel: (name) => {
                const currentPanels = this.#panels$.value;
                let panel = currentPanels.find(p => p.name === name);
                if (!panel) {
                    const panelEl = document.createElement('div');
                    panelEl.className = 'panel';
                    panel = { name, el: panelEl };
                    this.#panels$.next([...currentPanels, panel]);
                }
                return panel.el;
            },
            property: (name, options) => {
                const subject = new ObservableSubject(options.defaultValue);
                this.#state.properties[name] = { name, options, subject };
                this.#render();
                return subject;
            }
        };
    }

    #render() {
        const { sourceCode, properties } = this.#state;
        const hasProperties = Object.keys(properties).length > 0;



        const app = watch(this.#activeTab$, activeTab => watch(this.#panels$, panels => {
            this.#canvasEl.classList.toggle('active', activeTab === 'Canvas');
            this.#propsEl.classList.toggle('active', activeTab === 'Properties');
            this.#sourceEl.classList.toggle('active', activeTab === 'Source');
            panels.forEach(p => p.el.classList.toggle('active', activeTab === p.name));

            const renderTab = (name) => {
                return div({ className: 'tab' },
                    input({ type: 'radio', name: 'tabs', id: `tab-${name}`, checked: activeTab === name }),
                    label({ for: `tab-${name}` }, name).on({ click: () => this.#activeTab$.next(name) })
                );
            };

            return [
                div({ className: 'tabs' },
                    renderTab('Canvas'),
                    hasProperties && renderTab('Properties'),
                    renderTab('Source'),
                    ...panels.map(p => renderTab(p.name))
                ),
                div({ className: 'content-wrapper' },
                    div().opaque().on({ $attach: el => el.appendChild(this.#canvasEl) }),
                div({ $classes: ['panel', 'properties', activeTab === 'Properties' && 'active'] },
                    ...Object.values(properties).map(p => this.#renderProperty(p))
                ),
                div({ $classes: ['panel', 'source', activeTab === 'Source' && 'active'] },
                    pre(code({ class: 'language-javascript' }, sourceCode).on({ $update: (el) => { delete el.dataset.highlighted; hljs.highlightElement(el); } }))
                ),
                    ...panels.map(p => div().opaque().on({ $attach: el => el.appendChild(p.el) }))
                )
            ];
        }));

        reconcile(this.shadowRoot, [app]);
    }

    #renderProperty(prop) {
        const { name, options, subject } = prop;
        let control;
        switch (options.type) {
            case 'range':
                control = h('input', { type: 'range', min: options.min, max: options.max, value: options.defaultValue })
                    .on({ input: e => subject.next(e.target.value) });
                break;
            case 'text':
                control = h('input', { type: 'text', value: options.defaultValue })
                    .on({ input: e => subject.next(e.target.value) });
                break;
            default:
                control = span('Unknown property type');
        }
        return div({ $styling: { marginBottom: '0.5em' } },
            h('label', name),
            control
        );
    }
}

customElements.define('reel-demo', ReelDemo);