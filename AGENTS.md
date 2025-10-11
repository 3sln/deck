# Deck Agent Guidelines

This document outlines guidelines for LLM agents interacting with the `deck` project.

## 1. Core Architecture

- **Vite Plugin (Dev-Only):** The `vite-plugin.js` provides a zero-config development server. It generates a virtual `index.html` and uses Vite's HMR API to send granular file change events to the client.
- **Build Command (`bin/build.js`):** A separate `deck-build` command handles production builds. It programmatically invokes Vite to bundle the Deck application, copies all user project files, and generates a static, production-ready `index.html`.
- **Client-Side Database:** The application does **not** load all card content upfront. On first load, it receives a list of file paths and populates an **IndexedDB** database. All card content and search indices are stored and queried from the browser's database.
- **`ngin` State Management:** All application state is managed by `ngin`.
    - **`deck-demo` State:** Each `<deck-demo>` element has its own private, encapsulated `ngin` engine to manage its internal state (tabs, properties).
    - **Global App State:** The main application shell has a separate global `ngin` engine to manage UI state (the search query, selected card, etc.).
- **`<deck-demo>` Custom Element:** This is the main UI component for displaying live demos. It is defined in `src/deck-demo.js` and provides a `demoDriver` API (`dom`, `panel`, `property`) for demos to interact with its `ngin` state.
- **Configuration (`package.json`):** Both the dev plugin and the build script are configured via a `@3sln/deck` field in the user's `package.json`, allowing for shared settings like `title` and `importMap`.

## 2. Key Concepts & Conventions

- **HMR-Friendly Demos:** Demo scripts are responsible for their own HMR state preservation. They must use `import.meta.hot` to store and retrieve state across reloads to prevent the `deck-demo` driver from creating new properties.
- **Source Code Hiding:** Demo scripts can use `// deck:ignore:start` and `// deck:ignore:end` comments to hide boilerplate (like HMR logic) from the "Source" panel in the UI.
- **Reactive UI:** The entire UI is reactive, built with `dodo` and `bones`. Components `watch` `ngin` queries and re-render when the state changes.
- **State Isolation:** The application state (which card is selected) is completely separate from the internal state of any given `<deck-demo>` component (which tab is active within that demo).