import * as d from '@3sln/dodo';
import {cell, watch} from '@3sln/dodo/reactive';

/**
 * The demo shown on the `<deck-demo>` card.
 *
 * A demo module's default export is called with a `driver` and re-called with
 * the same argument whenever this file changes, so anything it sets up has to
 * be torn down through `driver.signal`.
 */
export default driver => {
  const step$ = driver.property('Step', {type: 'range', min: 1, max: 10, defaultValue: 1});
  const label$ = driver.property('Label', {type: 'text', defaultValue: 'Clicks'});

  driver.panel('Counter', (container, signal) => {
    const count = cell(0);
    let step = 1;
    let label = 'Clicks';

    const rerender = () => {
      d.reconcile(container, [
        watch(count, value =>
          d.div(
            {
              $styling: {
                display: 'flex',
                'align-items': 'center',
                gap: '1em',
                'font-family': 'system-ui, sans-serif',
                color: 'var(--text-color, #222)',
              },
            },
            d.button(
              {
                $styling: {
                  padding: '0.5em 1em',
                  'border-radius': '6px',
                  border: '1px solid #8884',
                  cursor: 'pointer',
                },
              },
              `+${step}`,
            ).on({click: () => count.update(n => n + step)}),
            d.span(`${label}: ${value}`),
          ),
        ),
      ]);
    };

    const subscriptions = [
      step$.subscribe(value => {
        step = Number(value) || 1;
        rerender();
      }),
      label$.subscribe(value => {
        label = value || 'Clicks';
        rerender();
      }),
    ];

    rerender();

    signal.addEventListener('abort', () => {
      subscriptions.forEach(subscription => subscription.unsubscribe());
      d.reconcile(container, null);
    });
  });
};
