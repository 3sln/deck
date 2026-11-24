export const viewerStyles = `
.deck-viewer {
  --deck-background: var(--bg-color, #faf9f6);
  --deck-surface: var(--card-bg, #fffefa);
  --deck-hover: var(--card-hover-bg, #f2efe8);
  --deck-text: var(--text-color, #282620);
  --deck-muted: var(--muted-color, #686259);
  --deck-border: var(--border-color, #e4ded3);
  --deck-input: var(--input-bg, var(--deck-surface));
  --deck-input-border: var(--input-border, var(--deck-border));
  --deck-accent: var(--link-color, #4c6144);
  --deck-accent-soft: color-mix(in srgb, var(--deck-accent) 10%, var(--deck-surface));
  --deck-radius: 0.75rem;
  --deck-panel-shadow: 0 12px 34px rgb(53 43 30 / 13%), 0 2px 6px rgb(53 43 30 / 6%);

  color-scheme: var(--deck-color-scheme, light dark);
  background: var(--deck-background);
  color: var(--deck-text);
  font-family: var(--deck-font-family, var(--font-family, system-ui, sans-serif));
  line-height: 1.5;
  container-type: inline-size;
  min-width: 0;
}

@media (prefers-color-scheme: dark) {
  .deck-viewer {
    --deck-background: var(--bg-color, #1c1b18);
    --deck-surface: var(--card-bg, #25241f);
    --deck-hover: var(--card-hover-bg, #302e27);
    --deck-text: var(--text-color, #ede9de);
    --deck-muted: var(--muted-color, #b4ad9f);
    --deck-border: var(--border-color, #403d33);
    --deck-accent: var(--link-color, #c0ceaa);
    --deck-panel-shadow: 0 12px 32px rgb(0 0 0 / 37%);
  }
}

.deck-viewer .deck-workspace {
  box-sizing: border-box;
  display: grid;
  gap: 1.5rem;
  margin-inline: auto;
  max-width: 78rem;
  padding: clamp(1.75rem, 5cqi, 4.5rem) clamp(1rem, 4cqi, 2.75rem) 3.5rem;
  position: relative;
}

.deck-viewer .deck-sidebar {
  box-sizing: border-box;
  justify-self: center;
  min-width: 0;
  width: min(100%, 42rem);
}

.deck-viewer .deck-brand-hero {
  display: flex;
  justify-content: center;
  margin-block: 0 0.9rem;
  margin-inline: 0;
}

.deck-viewer .deck-brand-hero img {
  block-size: auto;
  display: block;
  inline-size: auto;
  max-block-size: 5rem;
  max-inline-size: min(100%, 19rem);
  object-fit: contain;
}

.deck-viewer .deck-brand-hero.deck-wide-hero img {
  max-block-size: min(9rem, 24dvh);
  max-inline-size: 100%;
}

.deck-viewer .deck-search-bar {
  align-items: center;
  background: var(--deck-input);
  border: 1px solid var(--deck-input-border);
  border-radius: var(--deck-radius);
  display: flex;
  gap: 0.65rem;
  min-height: 3.25rem;
  padding-inline: 0.9rem 0.3rem;
  position: relative;
  z-index: 2;
}

.deck-viewer .deck-search-bar:has(.deck-search:focus) {
  border-color: var(--deck-accent);
  box-shadow: 0 0 0 3px var(--focus-ring, var(--deck-accent-soft));
}

.deck-viewer .deck-search-icon {
  color: var(--deck-muted);
  flex: none;
  inline-size: 1.25rem;
  block-size: 1.25rem;
  pointer-events: none;
}

.deck-viewer .deck-search-icon > svg {
  display: block;
  inline-size: 100%;
  block-size: 100%;
}

.deck-viewer .deck-search-brand {
  align-items: center;
  display: inline-flex;
  flex: none;
}

.deck-viewer img.deck-search-brand,
.deck-viewer .deck-search-brand img {
  block-size: auto;
  display: block;
  inline-size: auto;
  max-block-size: 1.5rem;
  max-inline-size: 3rem;
  object-fit: contain;
}

.deck-viewer :is(.deck-brand-hero, .deck-search-brand, .deck-search-icon)[hidden] {
  display: none;
}

.deck-viewer .deck-search {
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-sizing: border-box;
  color: inherit;
  flex: 1;
  font: inherit;
  min-height: 3.05rem;
  min-width: 0;
  outline: none;
  padding: 0;
  width: 100%;
}

.deck-viewer .deck-search::placeholder {
  color: var(--deck-muted);
}

.deck-viewer .deck-search-options {
  flex: none;
}

.deck-viewer :is(.deck-filter-trigger, .deck-filter-close, .deck-project-download, .deck-detail-download) {
  align-items: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0.55rem;
  box-sizing: border-box;
  color: var(--deck-muted);
  cursor: pointer;
  display: inline-flex;
  inline-size: 2.65rem;
  block-size: 2.65rem;
  justify-content: center;
  padding: 0;
}

.deck-viewer .deck-filter-trigger {
  list-style: none;
  position: relative;
}

.deck-viewer .deck-filter-trigger::-webkit-details-marker {
  display: none;
}

.deck-viewer :is(.deck-filter-trigger, .deck-filter-close, .deck-project-download, .deck-detail-download, .deck-detail-back) svg {
  block-size: 1.15rem;
  inline-size: 1.15rem;
  flex: none;
}

.deck-viewer .deck-filter-trigger svg {
  block-size: 1.25rem;
  inline-size: 1.25rem;
}

.deck-viewer .deck-filter-indicator {
  background: var(--deck-accent);
  border: 2px solid var(--deck-input);
  border-radius: 50%;
  box-sizing: content-box;
  inline-size: 0.35rem;
  block-size: 0.35rem;
  position: absolute;
  inset-block-start: 0.4rem;
  inset-inline-end: 0.35rem;
  pointer-events: none;
}

.deck-viewer .deck-search-options[open] > .deck-filter-trigger,
.deck-viewer :is(.deck-project-download, .deck-detail-download)[aria-pressed='true'] {
  background: var(--deck-accent-soft);
  border-color: color-mix(in srgb, var(--deck-accent) 28%, var(--deck-border));
  color: var(--deck-accent);
}

.deck-viewer .deck-filter-panel {
  background: var(--deck-surface);
  border: 1px solid var(--deck-border);
  border-radius: var(--deck-radius);
  box-sizing: border-box;
  box-shadow: var(--deck-panel-shadow);
  inline-size: min(23rem, 100%);
  max-block-size: min(33rem, calc(100dvh - 6rem));
  overflow: auto;
  overscroll-behavior: contain;
  padding: 0.9rem;
  position: absolute;
  inset-inline-end: 0;
  inset-block-start: calc(100% + 0.45rem);
}

.deck-viewer .deck-filter-panel[popover] {
  inset: auto;
  left: var(--deck-filter-left, 0px);
  top: var(--deck-filter-top, 0px);
  bottom: var(--deck-filter-bottom, auto);
  inline-size: var(--deck-filter-width, min(23rem, calc(100vw - 1rem)));
  max-block-size: var(--deck-filter-height, min(33rem, calc(100dvh - 1rem)));
  margin: 0;
  position: fixed;
}

.deck-viewer .deck-filter-sheet-header {
  display: none;
}

@media (max-width: 49rem) {
  .deck-viewer .deck-filter-panel[popover] {
    border-block-end: 0;
    border-start-start-radius: max(1rem, var(--deck-radius));
    border-start-end-radius: max(1rem, var(--deck-radius));
    border-end-start-radius: 0;
    border-end-end-radius: 0;
    inset: auto 0 0;
    inline-size: 100%;
    max-block-size: 75dvh;
    padding-block-end: max(1rem, env(safe-area-inset-bottom));
    padding-inline: max(1rem, env(safe-area-inset-left)) max(1rem, env(safe-area-inset-right));
  }

  .deck-viewer .deck-filter-panel[popover]::backdrop {
    background: rgb(16 15 13 / 35%);
    pointer-events: auto;
  }

  .deck-viewer .deck-filter-sheet-header {
    align-items: center;
    background: var(--deck-surface);
    border-block-end: 1px solid var(--deck-border);
    display: flex;
    gap: 0.75rem;
    inset-block-start: 0;
    justify-content: space-between;
    margin-block-end: 0.75rem;
    padding-block-end: 0.25rem;
    position: sticky;
    z-index: 1;
  }

  .deck-viewer .deck-filter-sheet-header :is(h2, p) {
    color: var(--deck-text);
    font-size: 0.95rem;
    font-weight: 650;
    margin: 0;
  }
}

.deck-viewer .deck-filter-panel > :not([hidden], .deck-filter-sheet-header) ~ :not([hidden]) {
  margin-block-start: 0.75rem;
}

.deck-viewer .deck-brand {
  align-items: center;
  color: inherit;
  display: flex;
  font-size: 0.875rem;
  font-weight: 650;
  gap: 0.55rem;
  margin: 0;
  overflow-wrap: anywhere;
  text-decoration: none;
}

.deck-viewer a.deck-brand:hover {
  color: var(--deck-accent);
}

.deck-viewer .deck-brand img {
  max-inline-size: 1.5rem;
  max-block-size: 1.5rem;
  object-fit: contain;
}

.deck-viewer .deck-filter-heading {
  color: var(--deck-muted);
  font-size: 0.78rem;
  font-weight: 650;
  margin-block: 0 0.25rem;
}

.deck-viewer .deck-project-list {
  display: grid;
  gap: 0.3rem;
}

.deck-viewer .deck-project-row {
  align-items: center;
  display: flex;
  font-size: 0.875rem;
  gap: 0.35rem;
  min-width: 0;
}

.deck-viewer .deck-project-row > span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.deck-viewer .deck-project-chip {
  align-items: stretch;
  border: 1px solid var(--deck-border);
  border-radius: 999rem;
  box-sizing: border-box;
  color: var(--deck-muted);
  display: inline-flex;
  max-inline-size: 100%;
  min-width: 0;
}

.deck-viewer .deck-project-chip:has(.deck-project-toggle[aria-pressed='true']) {
  background: var(--deck-accent-soft);
  border-color: color-mix(in srgb, var(--deck-accent) 32%, var(--deck-border));
  color: var(--deck-accent);
}

.deck-viewer .deck-project-shortcuts.deck-all-projects .deck-project-chip {
  background: transparent;
  border-color: var(--deck-border);
  color: var(--deck-muted);
}

.deck-viewer .deck-project-toggle,
.deck-viewer .deck-version-trigger {
  background: transparent;
  border: 0;
  box-sizing: border-box;
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-size: 0.825rem;
  line-height: 1.25;
  min-block-size: 1.9rem;
  min-width: 0;
  padding: 0.24rem 0.65rem;
}

.deck-viewer .deck-project-toggle {
  align-items: center;
  border-radius: 999rem;
  display: inline-flex;
  gap: 0.3rem;
}

.deck-viewer .deck-project-toggle > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.deck-viewer .deck-project-toggle > svg {
  block-size: 0.78rem;
  flex: none;
  inline-size: 0.78rem;
}

.deck-viewer .deck-project-toggle[aria-pressed='false'] > svg,
.deck-viewer .deck-version-option[aria-checked='false'] > svg {
  visibility: hidden;
}

.deck-viewer .deck-project-chip:has(.deck-version-trigger) .deck-project-toggle {
  border-start-end-radius: 0;
  border-end-end-radius: 0;
}

.deck-viewer .deck-version-trigger {
  align-items: center;
  border-radius: 999rem;
  display: inline-flex;
  flex: 0 0 auto;
  gap: 0.25rem;
  max-inline-size: min(45cqi, 8.25rem);
}

.deck-viewer .deck-project-toggle + .deck-version-trigger {
  border-inline-start: 1px solid color-mix(in srgb, currentColor 20%, transparent);
  border-start-start-radius: 0;
  border-end-start-radius: 0;
  padding-inline: 0.46rem;
}

.deck-viewer .deck-version-trigger > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.deck-viewer .deck-version-trigger > svg {
  block-size: 0.78rem;
  flex: none;
  inline-size: 0.78rem;
}

.deck-viewer :is(.deck-project-toggle, .deck-version-trigger):hover:not(:disabled),
.deck-viewer .deck-version-trigger[aria-expanded='true'] {
  background: var(--deck-hover);
  color: var(--deck-text);
}

.deck-viewer :is(.deck-project-toggle, .deck-version-trigger):focus-visible {
  position: relative;
  z-index: 1;
}

.deck-viewer .deck-project-download {
  block-size: 2.25rem;
  flex: none;
  inline-size: 2.25rem;
}

.deck-viewer .deck-version-menu[popover] {
  background: var(--deck-surface);
  border: 1px solid var(--deck-border);
  border-radius: var(--deck-radius);
  box-shadow: var(--deck-panel-shadow);
  box-sizing: border-box;
  color: var(--deck-text);
  inset: auto;
  margin: 0;
  max-block-size: min(19rem, calc(100dvh - 1rem));
  max-inline-size: min(21rem, calc(100vw - 1rem));
  min-inline-size: min(10rem, calc(100vw - 1rem));
  overflow: auto;
  overscroll-behavior: contain;
  padding: 0.28rem;
  position: fixed;
  width: max-content;
}

.deck-viewer .deck-version-option {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 0.45rem;
  box-sizing: border-box;
  color: inherit;
  cursor: pointer;
  display: flex;
  font: inherit;
  font-size: 0.875rem;
  gap: 0.6rem;
  inline-size: 100%;
  justify-content: space-between;
  min-block-size: 2.15rem;
  overflow-wrap: anywhere;
  padding: 0.35rem 0.6rem;
  text-align: start;
}

.deck-viewer .deck-version-option[aria-checked='true'] {
  background: var(--deck-accent-soft);
  color: var(--deck-accent);
  font-weight: 625;
}

.deck-viewer .deck-version-option > svg {
  block-size: 0.95rem;
  flex: none;
  inline-size: 0.95rem;
}

.deck-viewer .deck-version-option:hover {
  background: var(--deck-hover);
}

.deck-viewer .deck-version-option[aria-checked]:focus-visible {
  outline-offset: -2px;
}

.deck-viewer :is(.deck-panel-tags, .deck-shortcuts) {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.deck-viewer .deck-filter-panel > :is(.deck-brand, .deck-projects):not([hidden]) ~ .deck-filter-section {
  border-block-start: 1px solid var(--deck-border);
  padding-block-start: 0.75rem;
}

.deck-viewer .deck-shortcuts {
  margin-block-start: 0.7rem;
}

.deck-viewer .deck-mcp-endpoint {
  align-items: center;
  color: var(--deck-muted);
  display: flex;
  font-size: 0.75rem;
  gap: 0.4rem;
  inset-block-start: 0.45rem;
  inset-inline-end: clamp(1rem, 4cqi, 2.75rem);
  max-inline-size: min(30rem, calc(100% - 2rem));
  position: absolute;
}

.deck-viewer .deck-mcp-label {
  flex: none;
  font-weight: 650;
}

.deck-viewer .deck-mcp-url {
  direction: rtl;
  min-inline-size: 0;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.deck-viewer .deck-mcp-copy-status {
  color: var(--deck-accent);
  flex: 0 0 4.25em;
  text-align: end;
  white-space: nowrap;
}

.deck-viewer .deck-mcp-copy {
  align-items: center;
  background: transparent;
  border: 1px solid var(--deck-border);
  border-radius: 0.35rem;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  flex: 0 1 auto;
  font: inherit;
  gap: 0.25rem;
  min-block-size: 1.6rem;
  min-inline-size: 0;
  padding: 0.1rem 0.4rem;
}

.deck-viewer .deck-mcp-copy svg {
  block-size: 0.85rem;
  flex: none;
  inline-size: 0.85rem;
}

.deck-viewer .deck-action:where(:not(
  .deck-project-download,
  .deck-project-toggle,
  .deck-version-trigger,
  .deck-version-option,
  .deck-filter-close,
  .deck-mcp-copy,
  .deck-detail-download
)),
.deck-viewer :is(.deck-chip, .deck-detail-back) {
  background: transparent;
  border: 1px solid var(--deck-border);
  border-radius: 0.45rem;
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-size: 0.825rem;
  min-height: 2rem;
  padding: 0.24rem 0.65rem;
}

.deck-viewer .deck-chip {
  border-radius: 999rem;
  max-inline-size: 100%;
  overflow-wrap: anywhere;
}

.deck-viewer .deck-chip[aria-pressed='true'] {
  background: var(--deck-accent-soft);
  border-color: color-mix(in srgb, var(--deck-accent) 42%, var(--deck-border));
  color: var(--deck-accent);
}

.deck-viewer :is(.deck-action, .deck-chip, .deck-detail-back, .deck-project-download, .deck-detail-download, .deck-filter-trigger, .deck-filter-close):hover:not(:disabled) {
  background: var(--deck-hover);
  color: var(--deck-text);
}

.deck-viewer :is(button, select):disabled {
  cursor: wait;
  opacity: 0.6;
}

.deck-viewer :is(a, button, input:not(.deck-search), select, summary):focus-visible {
  outline: 2px solid var(--deck-accent);
  outline-offset: 2px;
}

.deck-viewer :is(.deck-brand, .deck-search-options, .deck-filter-indicator, .deck-filter-panel, .deck-filter-section, .deck-projects, .deck-panel-tags, .deck-shortcuts, .deck-project-download, .deck-detail-download, .deck-detail-context, .deck-detail)[hidden],
.deck-viewer :is(.deck-status, .deck-panel-tags, .deck-shortcuts, .deck-filter-panel):empty {
  display: none;
}

.deck-viewer .deck-status {
  color: var(--deck-muted);
  font-size: 0.825rem;
  margin-block: 0.7rem;
}

.deck-viewer .deck-results {
  display: grid;
  gap: 1.55rem;
  margin-block-start: 1.7rem;
}

.deck-viewer .deck-results > .deck-action {
  justify-self: start;
}

.deck-viewer .deck-section-heading {
  color: var(--deck-muted);
  font-size: 0.78rem;
  font-weight: 650;
  margin-block: 0 0.35rem;
  padding-inline: 0.6rem;
}

.deck-viewer .deck-cards {
  list-style: none;
  margin: 0;
  padding: 0;
}

.deck-viewer .deck-cards > li + li {
  border-block-start: 1px solid var(--deck-border);
}

.deck-viewer .deck-card {
  background: transparent;
  border: 0;
  border-radius: 0.45rem;
  box-sizing: border-box;
  color: inherit;
  cursor: pointer;
  display: grid;
  font: inherit;
  gap: 0.16rem;
  min-block-size: 3rem;
  overflow-wrap: anywhere;
  padding: 0.75rem 0.6rem;
  text-align: start;
  text-decoration: none;
  width: 100%;
}

.deck-viewer .deck-card:hover {
  background: var(--deck-hover);
}

.deck-viewer .deck-card[aria-current='true'] {
  background: var(--deck-accent-soft);
}

.deck-viewer .deck-card[aria-current='true'] .deck-card-title {
  color: var(--deck-accent);
}

.deck-viewer .deck-card-title {
  font-weight: 635;
}

.deck-viewer .deck-card-summary,
.deck-viewer .deck-card-project {
  color: var(--deck-muted);
  font-size: 0.875rem;
}

.deck-viewer .deck-card-summary {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.deck-viewer .deck-card-project {
  font-size: 0.75rem;
  margin-block-start: 0.15rem;
}

.deck-viewer .deck-detail {
  min-width: 0;
}

.deck-viewer .deck-detail-tools {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
  min-height: 2.65rem;
}

.deck-viewer .deck-detail-back {
  align-items: center;
  border-color: transparent;
  color: var(--deck-muted);
  display: inline-flex;
  gap: 0.35rem;
  min-height: 2.65rem;
  padding-inline: 0.45rem 0.6rem;
}

.deck-viewer .deck-detail-context {
  color: var(--deck-muted);
  font-size: 0.825rem;
  margin-block: 1.45rem 0.35rem;
  overflow-wrap: anywhere;
}

.deck-viewer .deck-detail h1 {
  font-size: clamp(1.9rem, 4cqi, 3.1rem);
  font-weight: 675;
  letter-spacing: -0.038em;
  line-height: 1.08;
  margin-block: 1.35rem 1.2rem;
  overflow-wrap: anywhere;
  text-wrap: balance;
}

.deck-viewer .deck-detail-context:not([hidden]) + h1 {
  margin-block-start: 0;
}

.deck-viewer .deck-detail h1:focus {
  outline: none;
}

.deck-viewer .deck-content {
  line-height: 1.7;
  max-width: 74ch;
  overflow-wrap: anywhere;
}

.deck-viewer .deck-content deck-demo {
  --bg-color: var(--deck-background);
  --text-color: var(--deck-text);
  --muted-color: var(--deck-muted);
  --border-color: var(--deck-border);
  --card-bg: var(--deck-surface);
  --card-hover-bg: var(--deck-hover);
  --input-bg: var(--deck-input);
  --input-border: var(--deck-input-border);
  --link-color: var(--deck-accent);
}

.deck-viewer .deck-content > :first-child {
  margin-block-start: 0;
}

.deck-viewer .deck-content :is(h2, h3, h4) {
  font-weight: 650;
  letter-spacing: -0.016em;
  line-height: 1.26;
  margin-block: 1.65em 0.55em;
  text-wrap: pretty;
}

.deck-viewer .deck-content p {
  margin-block: 1em;
}

.deck-viewer .deck-content a {
  color: var(--deck-accent);
  text-underline-offset: 0.15em;
}

.deck-viewer .deck-content :is(img, video) {
  height: auto;
  max-width: 100%;
}

.deck-viewer .deck-content pre {
  background: var(--deck-hover);
  border: 1px solid var(--deck-border);
  border-radius: var(--deck-radius);
  line-height: 1.55;
  overflow-x: auto;
  overflow-wrap: normal;
  padding: 0.85em;
}

.deck-viewer .deck-content pre > code.hljs {
  padding: 0;
}

.deck-viewer .deck-content :not(pre) > code:not(.hljs) {
  background: var(--deck-hover);
  border-radius: 0.25rem;
  font-size: 0.9em;
  padding: 0.12em 0.25em;
}

.deck-viewer .deck-content table {
  border-collapse: collapse;
  display: block;
  max-width: 100%;
  overflow-x: auto;
}

.deck-viewer .deck-content :is(th, td) {
  border: 1px solid var(--deck-border);
  padding: 0.4em 0.65em;
}

.deck-viewer .deck-content th {
  background: var(--deck-hover);
  text-align: start;
}

.deck-viewer .deck-content blockquote {
  border-inline-start: 2px solid var(--deck-border);
  color: var(--deck-muted);
  margin-inline: 0;
  padding-inline-start: 1em;
}

.deck-viewer .deck-content hr {
  border: 0;
  border-block-start: 1px solid var(--deck-border);
  margin-block: 2rem;
}

@container (max-width: 49rem) {
  .deck-viewer .deck-workspace.has-selection {
    gap: 0.8rem;
    padding-block-start: 0.8rem;
  }

  .deck-viewer .deck-workspace:has(> .deck-mcp-endpoint) {
    padding-block-start: max(2.9rem, 5cqi);
  }

  .deck-viewer .has-selection .deck-sidebar {
    width: 100%;
  }

  .deck-viewer .has-selection .deck-sidebar :is(.deck-results, .deck-shortcuts) {
    display: none;
  }

  .deck-viewer .has-selection .deck-detail {
    border-block-start: 1px solid var(--deck-border);
    padding-block-start: 0.6rem;
  }
}

@container (width > 49rem) {
  .deck-viewer .deck-workspace.has-selection {
    align-items: start;
    gap: clamp(1.25rem, 3cqi, 2.75rem);
    grid-template-columns: minmax(16rem, 1fr) minmax(0, 2.15fr);
    padding-block-start: clamp(1.75rem, 4cqi, 3.25rem);
  }

  .deck-viewer .has-selection .deck-detail {
    border-inline-start: 1px solid var(--deck-border);
    padding-inline-start: clamp(1.25rem, 3cqi, 3rem);
  }
}
`;
