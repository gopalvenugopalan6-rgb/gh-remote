# Graph Report - gh-remote  (2026-08-30)

## Corpus Check
- Corpus is ~15,081 words - fits in a single context window. You may not need a graph.

## Summary
- 181 nodes · 355 edges · 12 communities (7 shown, 5 thin omitted)
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 36 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- App Controller
- webOS Command Surface
- Mock TV Harness
- Architecture Rationale
- Build & Dependencies
- Connection & Pairing Core
- Browser Test Harness
- Pointer & Trackpad Input
- Local Persistence
- Theming & Layout
- Playwright Config
- Offline Shell

## God Nodes (most connected - your core abstractions)
1. `WebOSTV` - 51 edges
2. `boot()` - 19 edges
3. `connect()` - 12 edges
4. `afterConnect()` - 11 edges
5. `buzz()` - 11 edges
6. `toast()` - 10 edges
7. `wireSettings()` - 9 edges
8. `renderApps()` - 8 edges
9. `loadInputs()` - 8 edges
10. `wireTrackpad()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `connect()` --conceptually_related_to--> `Self-Signed Certificate Trust Ritual`  [INFERRED]
  js/app.js → README.md
- `Screenshot: Tactile theme, phone remote panel` --references--> `Three Themes as Pure CSS Custom Properties`  [INFERRED]
  icons/icon-512.png → overview.md
- `subscribeVolume()` --implements--> `Control Socket (wss://tv:3001)`  [EXTRACTED]
  js/app.js → overview.md
- `endpointsFor()` --implements--> `Port 3001 TLS vs 3000 Plain Fallback`  [EXTRACTED]
  js/webos.js → CLAUDE.md
- `pointerFrame()` --implements--> `Pointer Socket (newline text frames)`  [EXTRACTED]
  js/webos.js → overview.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **The three costs of going serverless** — serverless_architecture, self_signed_cert_barrier, wake_on_lan_impossible, browser_discovery_limits [EXTRACTED 0.95]
- **Everything a single button press must traverse** — control_socket, pointer_socket, js_webos_pointerframe, js_webos_webostv_openpointer, original_button_bug [EXTRACTED 0.93]
- **How a silently broken button is caught** — mock_tv_testing, wire_level_assertions, gh_pages_deploy, original_button_bug [EXTRACTED 0.90]

## Communities (12 total, 5 thin omitted)

### Community 0 - "App Controller"
Cohesion: 0.13
Nodes (42): actions, afterConnect(), apps, boot(), channels, connect(), emptyRow(), fallbackIcon() (+34 more)

### Community 2 - "Mock TV Harness"
Cohesion: 0.11
Nodes (19): APP_PORT, APPS, appServer, CHANNELS, control, DEFAULT_STATE, fs, http (+11 more)

### Community 3 - "Architecture Rationale"
Cohesion: 0.12
Nodes (17): Bridge / AP Mode Fix (Costs No Speed), No Multicast, No Local IP: Browser Discovery Limits, Client Key Stored Per-Device in localStorage, Content Security Policy via Meta Tag, GitHub Pages Deploy Gated on Tests, App Icons Blocked as Mixed Content, Cloud Server Cannot Reach a TV Behind NAT, No App Password: the TV's Prompt Is the Gate (+9 more)

### Community 4 - "Build & Dependencies"
Cohesion: 0.13
Nodes (14): description, devDependencies, @playwright/test, ws, name, private, scripts, dev (+6 more)

### Community 5 - "Connection & Pairing Core"
Cohesion: 0.21
Nodes (11): Control Socket (wss://tv:3001), Port 3001 TLS vs 3000 Plain Fallback, subscribeVolume(), endpointsFor(), pointerFrame(), REGISTER_MANIFEST, Mock TV Speaking the Real Protocol, Original Bug: Button JSON on the Control Socket (+3 more)

### Community 6 - "Browser Test Harness"
Cohesion: 0.29
Nodes (3): expectWire(), { test, expect }, wireLog()

### Community 9 - "Theming & Layout"
Cohesion: 0.50
Nodes (4): Screenshot: Tactile theme, phone remote panel, Icons Need symbol viewBox or They Crop, Tabs on Phone, Columns on Desktop, Three Themes as Pure CSS Custom Properties

## Knowledge Gaps
- **40 isolated node(s):** `http`, `fs`, `path`, `{ WebSocketServer }`, `ROOT` (+35 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 56 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `WebOSTV` connect `webOS Command Surface` to `App Controller`, `Connection & Pairing Core`, `Pointer & Trackpad Input`?**
  _High betweenness centrality (0.237) - this node is a cross-community bridge._
- **Why does `Self-Signed Certificate Trust Ritual` connect `Architecture Rationale` to `App Controller`, `webOS Command Surface`?**
  _High betweenness centrality (0.074) - this node is a cross-community bridge._
- **Why does `connect()` connect `App Controller` to `Architecture Rationale`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `boot()` (e.g. with `loadApps()` and `loadChannels()`) actually correct?**
  _`boot()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `connect()` (e.g. with `app.js` and `Self-Signed Certificate Trust Ritual`) actually correct?**
  _`connect()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `afterConnect()` (e.g. with `.openPointer()` and `.softwareInfo()`) actually correct?**
  _`afterConnect()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `http`, `fs`, `path` to the rest of the system?**
  _40 weakly-connected nodes found - possible documentation gaps or missing edges._