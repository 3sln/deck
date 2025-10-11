# Configuration

Deck is configured through a `@3sln/deck` field in your project's `package.json` file.

## The Override Model

Deck uses a simple override system for configuration. You can define a base configuration at the root of the `@3sln/deck` object. Then, you can create `dev` and `build` sub-objects to override any of those settings for a specific environment.

-   **Root Configuration**: The base settings used by both environments.
-   **`dev` Block**: Overrides for the development server (`vite`).
-   **`build` Block**: Overrides for the production build (`deck-build`).

When Deck loads, it merges the root configuration with the environment-specific block. For example, when running the `deck-build` command, Deck will merge the root `{...}` options with the `build: {...}` options.

## Configuration Options

Any of the following options can be placed at the root or within the `dev` and `build` blocks.

-   `title` (string): The title of your documentation site.

-   `pinned` (array of strings): A list of absolute paths to cards that should be pinned to the top of the card list.

-   `importMap` (object): An [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap) to be included in the `index.html`. This is essential for remapping module specifiers, especially for demos.

-   `outDir` (string): The output directory for the built site, relative to the project root. This is primarily useful in the `build` block. Defaults to `out`.

-   `pick` (object): A map of source paths to destination paths, allowing you to copy files or directories into the build output. This is primarily useful in the `build` block to include assets or dependencies for your static site.

## Example

Here is an example demonstrating the override system.

```json
{
  "@3sln/deck": {
    "title": "My Awesome Project",
    "importMap": {
      "imports": {
        "my-lib": "/node_modules/my-lib/index.js"
      }
    },
    "dev": {
      "title": "My Awesome Project (DEV)"
    },
    "build": {
      "outDir": "dist/docs",
      "pick": {
        "../node_modules/my-lib/dist": "lib/my-lib"
      },
      "importMap": {
        "imports": {
          "my-lib": "/lib/my-lib/index.js"
        }
      }
    }
  }
}
```

### Behavior

-   **`npm run dev`**: The title will be `My Awesome Project (DEV)` and `my-lib` will resolve to `/node_modules/my-lib/index.js`.
-   **`npm run build`**: The title will be `My Awesome Project`, the output will go to `dist/docs`, and the `importMap` will be overridden to point `my-lib` to the locally copied version at `/lib/my-lib/index.js`.
