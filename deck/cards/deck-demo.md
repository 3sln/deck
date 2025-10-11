# The `<deck-demo>` Element

The `<deck-demo>` custom element is the heart of Deck's interactive documentation. It allows you to embed live, stateful, and hot-reloading component demos directly in your Markdown files.

To use it, you place the tag in your Markdown, give it an id,
and point its `src` attribute to the demo script.

```markdown
<deck-demo id="my-awesome-demo" src="/demos/my-awesome-demo.js"></deck-demo>
```

## The Demo Script

The script referenced in `src` must have a default export that is a function. This function receives a `driver` object as its first argument.

```javascript
// /demos/my-awesome-demo.js
export default driver => {
  // Your demo logic goes here
};
```

## The Demo Driver API

The `driver` object is an API that allows your demo to interact with the `<deck-demo>` element's UI, which includes a source code viewer, property editor, and content panels.

### `driver.panel(name, renderFn)`

Creates a tabbed panel for rendering content.

-   `name` (string): The title of the tab.
-   `renderFn` (function): A function that receives `(container, signal)`.
    -   `container`: The HTML element to render your demo into.
    -   `signal`: An `AbortSignal` that fires when the demo is about to be unmounted. Use this for cleanup.

### `driver.property(name, {type, defaultValue})`

Creates a reactive property control in the "Properties" panel. This allows users to interact with your demo.  It returns an observable
that provides the current value of the property input.

-   `name` (string): The name of the property.
-   `type` (string, optional): The input type to render for the property.
-   `defaultValue` (optional): The initial value to use if the property doesn't already exist.

### `driver.setActivePanel(name)`

Programmatically sets the currently visible panel.

### `driver.signal`

An `AbortSignal` that's aborted when the demo is being torn down.

## Full Example

Here is a simple demo script that shows a message and lets the user control its text and color.

```javascript
import {p, reconcile} from '@3sln/dodo';

export default driver => {
  const message$ = driver.property('Message', { type: 'text', value: 'Hello, Deck!' });

  driver.panel('Demo', (container, signal) => {
    const render = (message) => {
      reconcile(container, [
        p({ $styling: { color: currentProps.textColor } },
          message
        )
      ]);
    };

    const sub = message$.subscribe(message => {
      render(message);
    });

    signal.addEventListener('abort', () => {
      sub.unsubscribe();
      reconcile(container, []);
    });
  });
};
```
