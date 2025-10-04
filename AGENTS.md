# Reel Agent Guidelines

This document outlines guidelines for LLM agents interacting with the `reel` project.

## 1. Core Architecture

- **Vite Plugin:** The primary distributable of `reel` is a Vite plugin, located in `vite-plugin.js`. This plugin provides a zero-config development environment.
- **Zero-Config Server:** The plugin's `configureServer` hook generates a virtual `index.html` on the fly. This is a critical feature. It means the user does not need an `index.html` or `main.js` in their project.
- **Card-Based Content:** The plugin uses `glob` to find all `*.md` and `*.html` files in the user's project, treating each one as a "card". This data is injected into the virtual `index.html`.
- **Manual HMR:** The plugin manually watches the documentation files using `server.watcher` and sends custom HMR events (`reel:cards-update`) to the client when files change, are added, or are removed.
- **`<reel-demo>` Custom Element:** This is the main UI component for displaying live demos. It is defined in `src/reel-demo.js`.
- **`demoDriver` API:** The `<reel-demo>` element provides a `demoDriver` object to the demo modules it loads. This API (`dom`, `panel`, `property`) is the primary way demos interact with the `reel` UI.
- **Module Loading:**
    - The `<reel-demo>` element uses a two-part strategy: it `fetch`es the raw source code (with `?raw`) for display and uses a standard dynamic `import()` to execute the module.
    - This relies on the Vite plugin injecting an `<script type="importmap">` into the virtual `index.html` to resolve package specifiers like `@3sln/dodo`.

## 2. Key Concepts & Conventions

- **Factory Usage:** The `reel` library itself is a consumer of `dodo` and `bones`. It imports the factories and creates its own internal instances, ensuring a single version of `dodo` is used.
- **Reactive UI:** The UI of the `<reel-demo>` component (tabs, panels) is built reactively using `ObservableSubject` and the `watch` component from `bones`.
- **Persistent Panels:** The DOM elements for the "Canvas", "Properties", "Source", and custom panels are created once and persist for the lifetime of the `<reel-demo>` element. They are attached to the `dodo`-managed VDOM using the `$attach` hook on opaque placeholder `div`s. This is a critical architectural detail to prevent the demo's state from being lost when switching tabs.

## 3. For Contributors

- **Separation of Concerns:** The Vite plugin should only handle build-time and server logic. All client-side UI and application logic should reside in the `src` directory.
- **Stateless VNodes:** Remember that `dodo` VNodes are transient. Do not attach state to them. Use the `$attach` hook to get a reference to the real DOM element when you need to perform imperative actions.