import * as dodo from '@3sln/dodo';
import observableFactory from '@3sln/bones/observable.js';
import busFactory from '@3sln/bones/bus.js';
import './reel-demo.js';

const { reconcile, div } = dodo;
const { watch } = observableFactory({ dodo });
const { ObservableSubject } = busFactory({ dodo });

/**
 * Renders the Reel UI into a target DOM element.
 * @param {object} options
 * @param {HTMLElement} options.target The DOM element to render into.
 * @param {Array} options.initialCards The initial array of card objects.
 */
export function renderReel({ target, initialCards }) {
    const cards$ = new ObservableSubject(initialCards);

    // Handle HMR updates from our custom plugin
    if (import.meta.hot) {
        import.meta.hot.on('reel:cards-update', (data) => {
            console.log('Card list changed, updating...');
            cards$.next(data.cards);
        });
    }

    const app = watch(cards$, (cards) => {
        return div({ $styling: { padding: '1em' } },
            ...cards.map(card => 
                div({ 
                    $styling: { 
                        border: '1px solid #eee', 
                        borderRadius: '4px', 
                        padding: '1em', 
                        marginBottom: '1em' 
                    },
                    innerHTML: card.html 
                }).opaque()
            )
        );
    });

    reconcile(target, [app]);
}
