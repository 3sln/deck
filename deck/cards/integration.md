---
tags: [embedding, MCP, offline, versions]
---

# Integrating Deck

Build a deck once and use its manifest in any of these integrations. Publish the manifest, search index, and card files together so their relative URLs resolve. If the stock UI or a custom browser UI loads a deck from another origin, configure that deck's host to allow cross-origin reads of those files.

## Use your own UI

The data module works independently of the stock UI. `openDeck` reads the manifest, `search` loads the prebuilt index for text queries, and `getCard` retrieves the raw Markdown or HTML body. Each result includes the card's `deckId`, `path`, and `slug`, along with `version` for a versioned deck. Use `slug` for public links and the source file `path` for `getCard` and offline saves. The card's `url` points to its source file.

```js
import {composeDecks, openDeck} from '@3sln/deck/data';

const guides = await openDeck({manifestUrl: '/guides/deck-manifest.json', id: 'guides'});
const api = await openDeck({manifestUrl: '/api/deck-manifest.json', id: 'api'});
const collection = composeDecks([guides, api]);

const results = await collection.search({query: 'configure', limit: 20});
if (results.length) {
  const {title, content, format} = await collection.getCard(results[0]);
  // Render the card in your application.
}

collection.setEnabled('api', false);
```

Use `collection.listCards()` for the enabled decks' metadata, `collection.listPinned()` for their pinned cards, and `collection.subscribe(listener)` to react to toggles. `search` also accepts `tags` to filter by all selected tags. Call `deck.search(options)` directly to get `{card, score}` results for one deck. Provide a custom `fetch` to `openDeck` if your host needs credentials or custom request handling. In a server runtime, use an absolute manifest URL.

Pass `offlineStore: createBrowserOfflineStore()` from `@3sln/deck/offline` to each browser deck to enable its `saveCard(path)`, `removeSavedCard(path)`, `saveProject()`, `removeSavedProject()`, and `offlineStatus()` methods.

## Choose versions in a composition

`openDeck` discovers the version catalog advertised by a manifest. To specify a catalog for your own composition, use `version`, `versions`, and `defaultVersion` on a deck descriptor. The same descriptor works in the stock UI's `decks` array.

```js
const guides = await openDeck({
  id: 'guides',
  manifestUrl: '/guides/v2/deck-manifest.json',
  version: 'v2',
  versions: [
    {id: 'v1', title: 'Version 1', manifestUrl: '/guides/v1/deck-manifest.json'},
  ],
  defaultVersion: 'v2',
});

const collection = composeDecks([guides]);
await collection.setVersion('guides', 'v1');
```

Relative URLs you provide in a browser descriptor resolve from the host page. You can omit `manifestUrl` and list every version in `versions`. In that case the first entry is the default unless you set `defaultVersion`. Use `versions: []` alongside `manifestUrl` to use only that manifest and skip any alternatives it advertises. For a single deck, `renderDeck({target, manifestUrl, version, versions, defaultVersion})` accepts the same version options directly.

A versioned deck exposes the active ID as `version` and the available entries as `versions`. In a custom UI, use `collection.subscribe(listener)` to refresh the deck's cards and search results after a switch. A deck used on its own offers `deck.setVersion(versionId)` and `deck.subscribeVersion(listener)`. The project keeps its ID and enabled state, and search results refer to the version that produced them. When navigation is enabled, the stock UI records the chosen versions in shareable card links and restores them on reload or browser Back.

## Embed the stock UI

```js
import {renderDeck} from '@3sln/deck';

await renderDeck({
  target: document.querySelector('#docs'),
  decks: [
    {id: 'guides', manifestUrl: '/guides/deck-manifest.json'},
    {id: 'api', manifestUrl: '/api/deck-manifest.json', enabled: false},
  ],
  brand: {name: 'Developer Docs', homeUrl: '/docs', logoUrl: '/logo.svg'},
  theme: {'--link-color': '#016b6b'},
  suggestedTags: ['setup', 'reference'],
  mcpUrl: 'https://docs.example.com/mcp',
});
```

For one deck, supply `manifestUrl` directly. To use an existing composition, supply it as `collection`. An embed leaves the host URL alone by default. Set `navigation: true` to sync search to `q` and the selected card's slug to `c`. A composed view also records the deck ID in `d`. For example, `?c=install-cli&d=guides` opens `install-cli` in the `guides` deck. To supply a custom tag suggestion function, use `suggestedTags: ({collection}) => [...]`.

Use project chips to toggle which projects are included in results. The caret beside a project's current version opens its version chooser. The filter control opens an anchored panel on desktop and a bottom sheet on phones. Both provide tags, project and version controls, and offline downloads.

Only compose decks you trust. The stock UI renders authored HTML and can execute demo modules referenced by cards.

## Serve the cards over MCP

`@3sln/deck/mcp` serves documentation from the published manifest. It offers `list_cards`, `search_cards`, and `read_card`. Each tool reads the same metadata, index, or card bodies as the UI.

```js
import {createDeckMcpHandler} from '@3sln/deck/mcp';

export const handleMcp = createDeckMcpHandler({
  manifestUrl: 'https://docs.example.com/deck-manifest.json',
});
```

Route `/mcp` to `handleMcp(request)` in a Fetch API host. The handler uses stateless Streamable HTTP. Wrap it with your application's authentication or authorization as needed. If a browser supplies an `Origin`, configure `allowedOrigins` and handle CORS in the host. Add the deployed endpoint to the stock UI using `mcpUrl`.

For stdio or another transport, use `createDeckMcp` with the same deck options. It takes a parsed JSON-RPC message and returns a reply to write back when one is present. Both factories accept a `decks` array for composed documentation. For a versioned project, the endpoint serves the default version. Set `defaultVersion` in that project's descriptor to choose which version the endpoint serves.
