import {composeDecks, openDeck} from './data.js';

const protocolVersion = '2026-07-28';
const legacyVersions = ['2025-11-25', '2025-06-18', '2025-03-26'];
const supportedVersions = [protocolVersion, ...legacyVersions];
const protocolKey = 'io.modelcontextprotocol/protocolVersion';
const toolAnnotations = {readOnlyHint: true, openWorldHint: false};
const limitSchema = {type: 'integer', minimum: 1, maximum: 100, default: 20};
const textSchema = {type: 'string', minLength: 1};

const tools = [
  {
    name: 'list_cards',
    description:
      'Browse the available documentation cards and get the deck ID and path for each card.',
    annotations: toolAnnotations,
    inputSchema: {
      type: 'object',
      properties: {limit: limitSchema, offset: {type: 'integer', minimum: 0, default: 0}},
      additionalProperties: false,
    },
  },
  {
    name: 'search_cards',
    description:
      'Search documentation by text and optionally filter by tags. Returns card metadata.',
    annotations: toolAnnotations,
    inputSchema: {
      type: 'object',
      properties: {query: textSchema, tags: {type: 'array', items: textSchema}, limit: limitSchema},
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_card',
    description:
      'Read the full documentation card by its deck ID and path from a list or search result.',
    annotations: toolAnnotations,
    inputSchema: {
      type: 'object',
      properties: {deckId: textSchema, path: textSchema},
      required: ['deckId', 'path'],
      additionalProperties: false,
    },
  },
];

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = value => typeof value === 'string' || Number.isInteger(value);

function rpcError(id, code, message, data) {
  const reply = {jsonrpc: '2.0', error: {code, message}};
  if (isId(id)) reply.id = id;
  if (data !== undefined) reply.error.data = data;
  return reply;
}

function unsupportedVersion(id, requested) {
  return rpcError(id, -32022, 'Unsupported protocol version', {
    requested,
    supported: [...supportedVersions],
  });
}

function toolResult(text, isError = false) {
  return {content: [{type: 'text', text}], isError};
}

function cardMetadata({deckId, deckTitle, path, title, summary, tags}) {
  return {deckId, deckTitle, path, title, summary, tags};
}

function loadCollection({manifestUrl, decks = [], fetch}) {
  const sources = manifestUrl === undefined ? decks : [manifestUrl, ...decks];
  if (!sources.length) throw new Error('A Deck manifest URL is required');
  const configs = sources.map(source =>
    typeof source === 'string' || source instanceof URL ? {manifestUrl: source} : {...source},
  );
  let current;
  let refreshAfter = 0;

  return () => {
    if (!current || Date.now() >= refreshAfter) {
      refreshAfter = Infinity;
      current = Promise.all(
        configs
          .filter(config => config.enabled !== false)
          .map(config => openDeck({...config, fetch: config.fetch ?? fetch})),
      )
        .then(decks => {
          const collection = composeDecks(decks);
          refreshAfter = Date.now() + 60_000;
          return collection;
        })
        .catch(error => {
          current = undefined;
          throw error;
        });
    }
    return current;
  };
}

function validateArgument(value, schema) {
  switch (schema.type) {
    case 'string':
      return typeof value === 'string' && value.length >= schema.minLength;
    case 'array':
      return Array.isArray(value) && value.every(item => validateArgument(item, schema.items));
    case 'integer':
      return (
        Number.isSafeInteger(value) &&
        value >= schema.minimum &&
        value <= (schema.maximum ?? Infinity)
      );
  }
}

async function callTool(getCollection, name, args, schema) {
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(args, key)) return toolResult(`Missing argument: ${key}`, true);
  }
  for (const [key, value] of Object.entries(args)) {
    if (
      !Object.hasOwn(schema.properties, key) ||
      !validateArgument(value, schema.properties[key])
    ) {
      return toolResult(`Invalid argument: ${key}`, true);
    }
  }

  try {
    const collection = await getCollection();
    const {limit = 20, offset = 0} = args;
    switch (name) {
      case 'list_cards': {
        const cards = collection.listCards();
        const end = offset + limit;
        return toolResult(
          JSON.stringify({
            cards: cards.slice(offset, end).map(cardMetadata),
            nextOffset: end < cards.length ? end : undefined,
          }),
        );
      }
      case 'search_cards': {
        const cards = await collection.search({query: args.query, tags: args.tags, limit});
        return toolResult(JSON.stringify({cards: cards.map(cardMetadata)}));
      }
      case 'read_card': {
        const {deckId, path} = args;
        const deck = collection.decks.find(deck => deck.id === deckId);
        if (
          !deck ||
          !collection.isEnabled(deckId) ||
          !deck.cards.some(card => card.path === path)
        ) {
          return toolResult(
            'Card not found. Use a deck ID and path from a list or search result.',
            true,
          );
        }
        const card = await collection.getCard({deckId, path});
        return toolResult(card.content);
      }
    }
  } catch {
    return toolResult('The documentation could not be loaded. Try again.', true);
  }
}

/** Create an async JSON-RPC message handler for use with a custom MCP transport. */
export function createDeckMcp(options = {}) {
  const getCollection = loadCollection(options);
  const serverInfo = {name: 'deck', version: '1.0.0', ...options.serverInfo};

  return async function handleMessage(message) {
    if (!isObject(message) || message.jsonrpc !== '2.0') {
      return rpcError(undefined, -32600, 'Invalid request');
    }
    const {id, method, params} = message;
    if (Object.hasOwn(message, 'id') && !isId(id)) {
      return rpcError(undefined, -32600, 'Invalid request ID');
    }
    if (typeof method !== 'string') {
      if (isId(id) && (isObject(message.result) || isObject(message.error))) return undefined;
      return rpcError(id, -32600, 'Invalid request');
    }
    if (id === undefined) return undefined;
    if (params !== undefined && !isObject(params)) return rpcError(id, -32602, 'Invalid params');

    const meta = params?._meta;
    const requested = meta?.[protocolKey];
    const modern = requested !== undefined || method === 'server/discover';
    if (modern) {
      if (typeof requested !== 'string')
        return rpcError(id, -32602, 'Missing protocol version metadata');
      if (requested !== protocolVersion) return unsupportedVersion(id, requested);
      if (!isObject(meta['io.modelcontextprotocol/clientCapabilities'])) {
        return rpcError(id, -32602, 'Missing client capabilities metadata');
      }
    }

    const success = result => ({
      jsonrpc: '2.0',
      id,
      result: modern ? {resultType: 'complete', ...result} : result,
    });

    switch (method) {
      case 'initialize':
        if (modern) return rpcError(id, -32601, 'Method not found');
        if (typeof params?.protocolVersion !== 'string') {
          return rpcError(id, -32602, 'Missing protocolVersion');
        }
        return success({
          protocolVersion: legacyVersions.includes(params.protocolVersion)
            ? params.protocolVersion
            : legacyVersions[0],
          capabilities: {tools: {}},
          serverInfo: {...serverInfo},
        });
      case 'server/discover':
        return success({
          supportedVersions: [...supportedVersions],
          capabilities: {tools: {}},
          _meta: {'io.modelcontextprotocol/serverInfo': {...serverInfo}},
        });
      case 'ping':
        return success({});
      case 'tools/list':
        if (params?.cursor !== undefined) return rpcError(id, -32602, 'Invalid cursor');
        return success({tools: structuredClone(tools)});
      case 'tools/call': {
        const args = params?.arguments === undefined ? {} : params.arguments;
        if (typeof params?.name !== 'string' || !isObject(args)) {
          return rpcError(id, -32602, 'Invalid tool call');
        }
        const tool = tools.find(tool => tool.name === params.name);
        if (!tool) return rpcError(id, -32602, 'Unknown tool');
        return success(await callTool(getCollection, tool.name, args, tool.inputSchema));
      }
      default:
        return rpcError(id, -32601, 'Method not found');
    }
  };
}

function readNameHeader(headers) {
  const value = headers.get('Mcp-Name');
  const encoded = value?.match(/^=\?base64\?(.*)\?=$/);
  if (!encoded) return value;
  const bytes = Uint8Array.from(atob(encoded[1]), char => char.charCodeAt(0));
  return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
}

function validateHeaders(headers, message) {
  const version = headers.get('MCP-Protocol-Version');
  const requested = message.params?._meta?.[protocolKey];
  if (version && !supportedVersions.includes(version))
    return unsupportedVersion(message.id, version);
  if (
    requested === undefined &&
    (version === null || legacyVersions.includes(version)) &&
    !headers.has('Mcp-Method') &&
    !headers.has('Mcp-Name') &&
    message.method !== 'server/discover'
  ) {
    return;
  }
  if (version === null || version !== requested) {
    return rpcError(
      message.id,
      -32020,
      'MCP-Protocol-Version header does not match request metadata',
    );
  }
  if (headers.get('Mcp-Method') !== message.method) {
    return rpcError(message.id, -32020, 'Mcp-Method header does not match the request method');
  }
  const name =
    message.method === 'resources/read'
      ? message.params?.uri
      : ['tools/call', 'prompts/get'].includes(message.method)
        ? message.params?.name
        : null;
  try {
    if (readNameHeader(headers) === name) return;
  } catch {
    // Malformed name headers are reported as header mismatches.
  }
  return rpcError(message.id, -32020, 'Mcp-Name header does not match the request');
}

function acceptsJson(accept) {
  if (!accept) return true;
  const matches = new Map();
  for (const offer of accept.toLowerCase().split(',')) {
    const [type, ...params] = offer.split(';').map(part => part.trim());
    const quality = params.find(param => param.startsWith('q='))?.slice(2) ?? '1';
    matches.set(type, Number(quality));
  }
  return (
    (matches.get('application/json') ?? matches.get('application/*') ?? matches.get('*/*') ?? 0) > 0
  );
}

/** Create a stateless Streamable HTTP handler for any host that exposes the Fetch API. */
export function createDeckMcpHandler({allowedOrigins = [], ...options} = {}) {
  const handle = createDeckMcp(options);
  const origins = new Set(allowedOrigins);
  const headers = {'Cache-Control': 'no-store'};

  return async function handleRequest(request) {
    const origin = request.headers.get('Origin');
    if (origin !== null && !origins.has(origin)) {
      return new Response(null, {status: 403, headers});
    }
    if (request.method !== 'POST') {
      return new Response(null, {status: 405, headers: {...headers, Allow: 'POST'}});
    }
    if (!acceptsJson(request.headers.get('Accept')))
      return new Response(null, {status: 406, headers});
    if (
      request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
    ) {
      return new Response(null, {status: 415, headers});
    }

    let message;
    try {
      message = await request.json();
    } catch {
      return Response.json(rpcError(undefined, -32700, 'Parse error'), {status: 400, headers});
    }
    if (
      isObject(message) &&
      isId(message.id) &&
      message.jsonrpc === '2.0' &&
      typeof message.method === 'string'
    ) {
      const error = validateHeaders(request.headers, message);
      if (error) return Response.json(error, {status: 400, headers});
    }

    const reply = await handle(message);
    if (!reply) return new Response(null, {status: 202, headers});
    const code = reply.error?.code;
    const modern =
      request.headers.has('Mcp-Method') || message?.params?._meta?.[protocolKey] !== undefined;
    const status =
      code === -32600 || code === -32022 || (modern && code === -32602)
        ? 400
        : modern && code === -32601
          ? 404
          : 200;
    return Response.json(reply, {status, headers});
  };
}
