# Reel Agent Guidelines

This document outlines guidelines for LLM agents interacting with the `reel` project.

## 1. Core Architecture

- **Vite Plugin (Dev-Only):** The `vite-plugin.js` provides a zero-config development server. It generates a virtual `index.html` and uses Vite's HMR API to send granular file change events to the client.
- **Build Command (`bin/build.js`):** A separate `reel-build` command handles production builds. It programmatically invokes Vite to bundle the Reel application, copies all user project files, and generates a static, production-ready `index.html`.
- **Client-Side Database:** The application does **not** load all card content upfront. On first load, it receives a list of file paths and populates an **IndexedDB** database. All card content and search indices are stored and queried from the browser's database.
- **`ngin` State Management:** All application state is managed by `ngin`.
    - **`reel-demo` State:** Each `<reel-demo>` element has its own private, encapsulated `ngin` engine to manage its internal state (tabs, properties).
    - **Global App State:** The main application shell has a separate global `ngin` engine to manage UI state (the search query, selected card, etc.).
- **`<reel-demo>` Custom Element:** This is the main UI component for displaying live demos. It is defined in `src/reel-demo.js` and provides a `demoDriver` API (`dom`, `panel`, `property`) for demos to interact with its `ngin` state.
- **Configuration (`package.json`):** Both the dev plugin and the build script are configured via a `@3sln/reel` field in the user's `package.json`, allowing for shared settings like `title` and `importMap`.

## 2. Key Concepts & Conventions

- **HMR-Friendly Demos:** Demo scripts are responsible for their own HMR state preservation. They must use `import.meta.hot` to store and retrieve state across reloads to prevent the `reel-demo` driver from creating new properties.
- **Source Code Hiding:** Demo scripts can use `// reel:ignore:start` and `// reel:ignore:end` comments to hide boilerplate (like HMR logic) from the "Source" panel in the UI.
- **Reactive UI:** The entire UI is reactive, built with `dodo` and `bones`. Components `watch` `ngin` queries and re-render when the state changes.
- **State Isolation:** The application state (which card is selected) is completely separate from the internal state of any given `<reel-demo>` component (which tab is active within that demo).
