# Core Concepts

Deck's design is based on a few key architectural choices.

## Client-Side Indexing

Deck uses a client-side database (IndexedDB) to store and index documentation content. The initial `index.html` file contains a manifest of all card paths along with a hash of their content.

Upon loading, the application compares this manifest with the data already stored in its IndexedDB. It then begins fetching and indexing any cards that are new or have changed content in the background. This process populates a full-text search index, allowing users to search across the entire documentation set.

Assets that are not cards, such as the JavaScript files for `<deck-demo>` elements, are not pre-fetched. They are fetched and cached by the service worker only when a user views them for the first time.

## The `<deck-demo>` Element

The `<deck-demo>` custom element is used to embed live demos in Markdown files. Its `src` attribute points to a JavaScript file.

The script is executed within the element and is provided with a `driver` API. This API allows the demo to render content and manage its own state, keeping it isolated from the main Deck application and other demos.

## Build Process

Deck has two modes of operation:

1.  **Development (`vite`):** The Vite plugin (`@3sln/deck/vite-plugin`) is used for development. It creates a dev server, generates a virtual `index.html` to run the application, and enables Hot Module Replacement (HMR).

2.  **Production (`deck-build`):** The `deck-build` command is used to create a production-ready static site. It bundles the Deck application, copies the project's documentation files, and generates a static `index.html` for deployment.
