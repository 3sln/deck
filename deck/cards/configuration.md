---
tags: [configuration, theming, versions]
---

# Configuration

Deck is configured through a `@3sln/deck` field in your project's `package.json` file.

## The Override Model

Deck uses a simple override system for configuration. You can define a base configuration at the root of the `@3sln/deck` object. Then, you can create `dev` and `build` sub-objects to override any of those settings for a specific environment.

-   **Root Configuration**: The base settings used by both environments.
-   **`dev` Block**: Overrides for the development server (`deck-dev`, or whichever dev server plugin you use).
-   **`build` Block**: Overrides for the production build (`deck-build`).

When Deck loads, it merges the root configuration with the environment-specific block. For example, when running the `deck-build` command, Deck will merge the root `{...}` options with the `build: {...}` options.

## Configuration Options

Any of the following options can be placed at the root or within the `dev` and `build` blocks.

-   `title` sets the deck name and the default page title. `id` sets the primary deck's stable identifier in composed links, such as `?c=install-cli&d=guides`.

-   `pinned` lists deck-root paths such as `/cards/introduction.md` to feature in the stock card list.

-   `decks` lists additional projects to show alongside this deck. Each entry is a manifest URL or an object with `manifestUrl` and optional `id`, `title`, and `enabled`. Give each entry a distinct ID for stable links. Set `enabled` to `false` to start with that project deselected. A descriptor can also set its own `version`, `versions`, and `defaultVersion`.

-   `brand` accepts `name`, `logoUrl`, `heroUrl`, and `homeUrl`. Supply a logo or hero to add an image above search. While searching or reading, the hero collapses and the logo, if provided, moves into the search field. `theme` sets CSS custom properties scoped to the stock UI. For example, set `"--link-color": "#5b4be0"` to change the accent.

-   `suggestedTags` accepts an array of tag labels to feature in the search shortcuts or `false` to hide suggested tag shortcuts. By default, suggestions come from common tags in the selected decks. Readers can browse available tags in the filter menu.

-   `mcpUrl` shows an existing MCP endpoint above search with a copy button.

-   `ui` defaults to `true`. Set it to `false` to use the dev or build output with your own UI. The manifest, search index, and card files are still available.

-   `include` and `exclude` are glob arrays that control which project files Deck reads and copies. Included `.md` and `.html` files become cards.

-   `importMap` (object): An [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap) to be included in the `index.html`. This is essential for remapping module specifiers, especially for demos.

-   `outDir` (string): The output directory for the built site, relative to the project root. This is primarily useful in the `build` block. Defaults to `out`.

-   `url` (string): Where this deck is published, e.g. `https://deck.3sln.com`. A sitemap needs absolute URLs and only you know them, so setting this is what produces `sitemap.xml`; `robots.txt` and `llms.txt` are written either way, with relative links when it is unset.

-   `description` (string): One sentence about the deck. Used for the page's `<meta name="description">` and as the summary line in `llms.txt`.

-   `esbuild` (object): Options passed to esbuild when it bundles your `<deck-demo>` modules — `alias`, `define`, `loader`, `tsconfig`, `jsxImportSource` and friends. Under the Vite plugin a demo is resolved by your own Vite config and this is not needed; every other dev server, and the build, bundle demos with esbuild and would otherwise not know what `@app/button` refers to.

    ```json
    {
      "@3sln/deck": {
        "esbuild": {
          "alias": {"@app": "./src"},
          "define": {"__DEV__": "true"}
        }
      }
    }
    ```

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

## Card links

Deck generates a lowercase slug from each card's file path. It drops the file extension and an initial `cards/` directory, while retaining nested directories. For example, `cards/Install-CLI.md` becomes `install-cli` and `cards/Reference/Client.md` becomes `reference/client`. If generated slugs collide, Deck assigns suffixes such as `-2` and `-3` in a consistent order.

Set `slug` in a Markdown card's YAML front matter to choose its link. Use a slug such as `install-cli` or `reference/client`. Deck normalizes case and rejects empty values and relative segments such as `.` and `..`. An explicit slug reserves that name ahead of generated slugs. Duplicate explicit slugs in one deck cause the build to fail. Keep the slug when renaming a source file to preserve its short link.

```markdown
---
slug: install-cli
---

# Install the CLI
```

The standalone link is `?c=install-cli`. In a composed UI, use `?c=install-cli&d=guides` for the deck with the ID `guides`. Existing bookmarks using file paths or the older deck-qualified values still work.

## Publish multiple versions

Build each version of your documentation from its own source and publish it at its own URL. Set the current build's version ID with `version`. Add a `versions` array of other published versions with an `id`, a `manifestUrl`, and an optional display `title`. Set `defaultVersion` to choose the version readers see first. It defaults to the current build.

For example, publish the current build at `/docs/v2/` and advertise the previous build at `/docs/v1/`.

```json
{
  "@3sln/deck": {
    "title": "My Project",
    "id": "my-project",
    "version": "v2",
    "versions": [
      {"id": "v1", "title": "Version 1", "manifestUrl": "../v1/deck-manifest.json"}
    ],
    "defaultVersion": "v2"
  }
}
```

The manifest advertises this catalog to consumers. Relative URLs in the catalog resolve from that manifest. The stock UI uses one version of each project at a time for browsing and search. Offline saves apply to the selected version.

## Files for Crawlers and Agents

A deck is a single-page application: every card lives behind a `?c=` query parameter and its body arrives by fetch. Anything that does not run JavaScript sees one nearly empty page. So `deck-build` also writes the content down where it can be read directly:

-   **`/llms.txt`** follows the [llmstxt.org](https://llmstxt.org) convention. It lists the deck's title, description, and a link to each card file.
-   **`/agents.md`** and **`/agents.html`** — every card concatenated into one document, with the source of each live demo inlined where its `<deck-demo>` tag was.
-   **`/robots.txt`** — allows everything, and names the sitemap when `url` is set.
-   **`/sitemap.xml`** lists card URLs when `url` is set. When the stock UI opens the current build by default, the sitemap includes the page root and UI links. A data-only build or a build that opens a different version links directly to the current build's card files.

When the stock UI is enabled, the generated `index.html` also carries `<link rel="alternate">` tags pointing at `/agents.md` and `/llms.txt`, so an agent that starts at the page still finds them.
