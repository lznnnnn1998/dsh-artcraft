/**
 * dsh-artcraft-preview-panel — browser closure-factory bundle.
 *
 * Generated from src/client.tsx by scripts/build.mjs — do not edit by hand.
 * The module loader registers this factory and materializes it on first
 * import; every module-body side effect (the injected stylesheet included)
 * stays inside the factory closure, matching the tsdown client envelope.
 */
window.__ModuleLoader__.load({
	id: "dsh-artcraft-preview-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		"use strict";
		Object.defineProperty(exports, "__esModule", { value: true });
		exports.inject = void 0;
		exports.PreviewPanel = PreviewPanel;
		exports.apply = apply;
		const jsx_runtime_1 = require("react/jsx-runtime");
		/**
		 * Browser half of the ArtCraft live-preview panel.
		 *
		 * Two contributions, both through the slot system:
		 *
		 * - `main`, keyed by `artcraft-preview`: the full-width panel that reads the
		 *   layer-B preview server (`docs/PREVIEW.md`) and shows the agent's steps, the
		 *   current render, the filmstrip, and the document metadata.
		 * - `sidebar.panellist`, id `artcraft-preview`: the launcher row that selects
		 *   the panel above.
		 *
		 * The panel consumes the documented HTTP surface only — `GET /state` for the
		 * merged `index.json` + per-craft `state.json`, `GET /img/<craft>/<file>` for
		 * renders and thumbnails. A cross-origin `fetch` needs the layer-B server to
		 * answer with CORS headers; when it cannot be read, the panel can embed the
		 * layer-B page itself (`GET /`) in an iframe, which needs no CORS.
		 *
		 * Runtime dependencies are `react` and `react/jsx-runtime` only. Both are
		 * platform modules the Web shell seeds into the frozen module table, so this
		 * bundle requires no package-module factory from another client plugin.
		 * @module dsh-artcraft-preview-panel/client
		 */
		const react_1 = require("react");
		/** Layer B's fixed loopback origin (see `docs/PREVIEW.md`, "HTTP endpoints"). */
		const PREVIEW_ORIGIN = 'http://127.0.0.1:4177';
		/** The main-panel key and the sidebar-list id: one identity for both seats. */
		const PANEL_ID = 'artcraft-preview';
		/** Sidebar row label; a plain string is accepted by the list seat. */
		const PANEL_LABEL = 'ArtCraft preview';
		/** Poll cadence for `/state`. The contract is a state directory, not a socket. */
		const POLL_MS = 2000;
		/** The injected stylesheet's ownership id (matches the tsdown `data-plugin-css` convention). */
		const STYLE_ID = 'dsh-artcraft-preview-panel/panel.css';
		/** Cordis services this browser plugin needs before it applies. */
		exports.inject = ['slots'];
		/** Narrow a decoded JSON value to an object. */
		function asRecord(value) {
		    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
		}
		/** Read a non-empty string field. */
		function asText(value) {
		    return typeof value === 'string' && value.length > 0 ? value : undefined;
		}
		/** Read a finite number field. */
		function asNumber(value) {
		    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
		}
		/** Read an array field, defaulting to empty. */
		function asList(value) {
		    return Array.isArray(value) ? value : [];
		}
		/** Normalize one step entry. */
		function normalizeStep(value, index) {
		    const entry = asRecord(value);
		    if (entry === undefined)
		        return undefined;
		    return {
		        n: asNumber(entry.n) ?? index + 1,
		        at: asText(entry.at),
		        tool: asText(entry.tool),
		        title: asText(entry.title),
		        summary: asText(entry.summary),
		        // The live state server also publishes ready-made `imageUrl`/`thumbUrl`
		        // fields; prefer them so a future path-prefix change keeps working.
		        image: asText(entry.imageUrl) ?? asText(entry.image),
		        thumb: asText(entry.thumbUrl) ?? asText(entry.thumb),
		        width: asNumber(entry.width),
		        height: asNumber(entry.height),
		        durationMs: asNumber(entry.durationMs),
		    };
		}
		/** Normalize the optional timeline of a video-shaped craft. */
		function normalizeTimeline(value) {
		    const segments = [];
		    for (const raw of asList(value)) {
		        const entry = asRecord(raw);
		        if (entry === undefined)
		            continue;
		        const start = asNumber(entry.start);
		        const duration = asNumber(entry.duration);
		        if (start === undefined || duration === undefined)
		            continue;
		        segments.push({ start, duration, label: asText(entry.label) ?? `clip ${segments.length + 1}` });
		    }
		    return segments;
		}
		/**
		 * Normalize one craft entry. `docs/PREVIEW.md` says `/state` is "index.json plus
		 * every craft's state.json, merged"; a wrapper (`{ index, state }`) is accepted
		 * too so the panel does not depend on which merge shape layer B chose.
		 */
		function normalizeCraft(key, value) {
		    const wrapper = asRecord(value) ?? {};
		    const state = asRecord(wrapper.state) ?? wrapper;
		    return {
		        craft: asText(state.craft) ?? asText(wrapper.craft) ?? key,
		        product: asText(state.product) ?? asText(wrapper.product),
		        file: asText(state.file) ?? asText(wrapper.file),
		        pages: asNumber(state.pages) ?? asNumber(wrapper.pages),
		        updatedAt: asText(state.updatedAt) ?? asText(wrapper.updatedAt),
		        current: asNumber(state.current) ?? asNumber(wrapper.current),
		        steps: asList(state.steps)
		            .map((step, index) => normalizeStep(step, index))
		            .filter((step) => step !== undefined),
		        timeline: normalizeTimeline(state.timeline ?? wrapper.timeline),
		    };
		}
		/** Normalize the whole `/state` payload. */
		function normalizeSnapshot(value) {
		    const root = asRecord(value) ?? {};
		    const index = asRecord(root.index) ?? root;
		    const craftsRaw = asRecord(root.crafts) ?? asRecord(index.crafts) ?? {};
		    const crafts = {};
		    for (const [key, craft] of Object.entries(craftsRaw))
		        crafts[key] = normalizeCraft(key, craft);
		    return {
		        updatedAt: asText(root.updatedAt) ?? asText(index.updatedAt),
		        crafts,
		    };
		}
		/** Read `/state`; the only write-free call the panel makes. */
		async function readState(signal) {
		    const response = await fetch(`${PREVIEW_ORIGIN}/state`, { signal, cache: 'no-store' });
		    if (!response.ok)
		        throw new Error(`GET /state answered HTTP ${String(response.status)} ${response.statusText}`.trim());
		    return normalizeSnapshot(await response.json());
		}
		// ── formatting helpers ──────────────────────────────────────────────────────
		/** The craft with the newest `updatedAt`; registration order breaks ties. */
		function pickLatest(crafts) {
		    let best;
		    let bestAt = Number.NEGATIVE_INFINITY;
		    for (const [key, craft] of Object.entries(crafts)) {
		        const parsed = craft.updatedAt === undefined ? Number.NaN : Date.parse(craft.updatedAt);
		        const score = Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
		        if (best === undefined || score > bestAt) {
		            best = key;
		            bestAt = score;
		        }
		    }
		    return best;
		}
		/** The last path segment, for a compact title. */
		function basename(path) {
		    if (path === undefined)
		        return undefined;
		    const parts = path.split(/[\\/]/u).filter(part => part.length > 0);
		    return parts[parts.length - 1];
		}
		/** Milliseconds between an ISO timestamp and now, or undefined when unparseable. */
		function ageOf(iso, now) {
		    if (iso === undefined)
		        return undefined;
		    const parsed = Date.parse(iso);
		    return Number.isFinite(parsed) ? Math.max(0, now - parsed) : undefined;
		}
		/** A compact "x s ago" label, or null when the timestamp is missing. */
		function formatAgo(iso, now) {
		    const age = ageOf(iso, now);
		    if (age === undefined)
		        return null;
		    if (age < 1000)
		        return `${(age / 1000).toFixed(1)} s ago`;
		    if (age < 60_000)
		        return `${String(Math.round(age / 1000))} s ago`;
		    if (age < 3_600_000)
		        return `${String(Math.round(age / 60_000))} min ago`;
		    return new Date(now - age).toLocaleTimeString();
		}
		/** A compact duration label. */
		function formatDuration(ms) {
		    if (ms === undefined)
		        return '—';
		    if (ms < 1000)
		        return `${String(Math.round(ms))} ms`;
		    if (ms < 60_000)
		        return `${(ms / 1000).toFixed(1)} s`;
		    return `${String(Math.floor(ms / 60_000))}m ${String(Math.round((ms % 60_000) / 1000))}s`;
		}
		/** A whole-second timeline label. */
		function formatSeconds(seconds) {
		    const rounded = Math.round(seconds * 10) / 10;
		    return Number.isInteger(rounded) ? `${String(rounded)}s` : `${rounded.toFixed(1)}s`;
		}
		/**
		 * Resolve a render reference against the preview origin. `state.json` writes a
		 * file name relative to the craft directory; the live server additionally
		 * publishes a root-relative `imageUrl`.
		 */
		function imageUrl(craft, file) {
		    if (/^https?:\/\//u.test(file))
		        return file;
		    if (file.startsWith('/'))
		        return `${PREVIEW_ORIGIN}${file}`;
		    const path = file
		        .split('/')
		        .filter(part => part.length > 0 && part !== '.' && part !== '..')
		        .map(part => encodeURIComponent(part))
		        .join('/');
		    return `${PREVIEW_ORIGIN}/img/${encodeURIComponent(craft)}/${path}`;
		}
		/** A fetch failure's message (the browser hides the status of a CORS refusal). */
		function describeError(cause) {
		    if (cause instanceof Error)
		        return cause.message.length > 0 ? cause.message : cause.name;
		    return String(cause);
		}
		// ── small presentational pieces ─────────────────────────────────────────────
		/** Sidebar launcher glyph. The sidebar owns the accessible name. */
		function PreviewIcon(props) {
		    const size = typeof props.size === 'number' ? props.size : 16;
		    return ((0, jsx_runtime_1.jsxs)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [(0, jsx_runtime_1.jsx)("rect", { x: "1.6", y: "2.4", width: "12.8", height: "9.2", rx: "2", stroke: "currentColor", strokeWidth: "1.3" }), (0, jsx_runtime_1.jsx)("path", { d: "M5.6 14h4.8M8 11.8V14", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round" }), (0, jsx_runtime_1.jsx)("path", { d: "M6.1 7.5l1.4-1.8 1.2 1.4 1.2-1.3", stroke: "currentColor", strokeWidth: "1.2", strokeLinecap: "round", strokeLinejoin: "round" })] }));
		}
		/** One label/value row of the metadata card. */
		function Kv(props) {
		    return ((0, jsx_runtime_1.jsxs)("div", { className: "acp-kv", children: [(0, jsx_runtime_1.jsx)("span", { children: props.label }), (0, jsx_runtime_1.jsx)("b", { title: typeof props.value === 'string' ? props.value : undefined, children: props.value })] }));
		}
		/** Proportional timeline of a video-shaped craft. */
		function Timeline(props) {
		    const total = Math.max(0, ...props.segments.map(segment => segment.start + segment.duration)) || 1;
		    return ((0, jsx_runtime_1.jsxs)("div", { className: "acp-timeline", role: "img", "aria-label": "Render timeline", children: [props.segments.map((segment, index) => ((0, jsx_runtime_1.jsx)("span", { className: `acp-seg acp-seg--${index % 2 === 0 ? 'a' : 'b'}`, style: { left: `${String((segment.start / total) * 100)}%`, width: `${String((segment.duration / total) * 100)}%` }, title: `${segment.label} · ${formatSeconds(segment.duration)}` }, `${segment.label}-${String(index)}`))), (0, jsx_runtime_1.jsx)("span", { className: "acp-ticks", children: [0, 0.25, 0.5, 0.75, 1].map(fraction => ((0, jsx_runtime_1.jsx)("span", { children: formatSeconds(total * fraction) }, String(fraction)))) })] }));
		}
		/** First-contact state: the server has not answered yet. */
		function Connecting() {
		    return ((0, jsx_runtime_1.jsxs)("div", { className: "acp-center", children: [(0, jsx_runtime_1.jsx)("div", { className: "acp-spinner", "aria-hidden": "true" }), (0, jsx_runtime_1.jsx)("p", { className: "acp-center-title", children: "Connecting to the preview server\u2026" }), (0, jsx_runtime_1.jsx)("p", { className: "acp-muted", children: PREVIEW_ORIGIN })] }));
		}
		/** The state endpoint is unavailable; explain the two independent causes. */
		function Unreachable(props) {
		    return ((0, jsx_runtime_1.jsx)("div", { className: "acp-center", children: (0, jsx_runtime_1.jsxs)("div", { className: "acp-notice", children: [(0, jsx_runtime_1.jsx)("h2", { children: "The live preview is not reachable" }), (0, jsx_runtime_1.jsx)("p", { className: "acp-mono acp-muted", children: props.message }), (0, jsx_runtime_1.jsxs)("p", { children: ["The panel reads the layer-B preview server at ", (0, jsx_runtime_1.jsx)("code", { children: PREVIEW_ORIGIN }), ", so two things must hold:"] }), (0, jsx_runtime_1.jsxs)("ol", { children: [(0, jsx_runtime_1.jsxs)("li", { children: ["the server is running (layer B of ", (0, jsx_runtime_1.jsx)("code", { children: "docs/PREVIEW.md" }), " owns it);"] }), (0, jsx_runtime_1.jsxs)("li", { children: ["its ", (0, jsx_runtime_1.jsx)("code", { children: "/state" }), " answer allows this origin. A cross-origin ", (0, jsx_runtime_1.jsx)("code", { children: "fetch" }), " needs", ' ', (0, jsx_runtime_1.jsx)("code", { children: "Access-Control-Allow-Origin" }), "; without it the browser rejects the read even though the server is up."] })] }), (0, jsx_runtime_1.jsxs)("p", { children: ["The ", (0, jsx_runtime_1.jsx)("em", { children: "Raw page" }), " view embeds the server's own page and needs no CORS, but it does need the server to allow being framed (", (0, jsx_runtime_1.jsx)("code", { children: "frame-ancestors" }), "). When both routes are refused, use", ' ', (0, jsx_runtime_1.jsx)("em", { children: "Open" }), " to view layer B in its own tab."] }), (0, jsx_runtime_1.jsxs)("div", { className: "acp-row", children: [(0, jsx_runtime_1.jsx)("button", { type: "button", className: "acp-btn acp-btn--primary", onClick: props.onRetry, children: "Retry" }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "acp-btn", onClick: props.onShowPage, children: "Show the layer-B page" })] })] }) }));
		}
		/** Reachable server, no craft touched yet. */
		function Empty() {
		    return ((0, jsx_runtime_1.jsx)("div", { className: "acp-center", children: (0, jsx_runtime_1.jsxs)("div", { className: "acp-empty", children: [(0, jsx_runtime_1.jsx)("div", { className: "acp-empty-mark", "aria-hidden": "true", children: "\u25EB" }), (0, jsx_runtime_1.jsx)("h2", { children: "No ArtCraft document yet" }), (0, jsx_runtime_1.jsx)("p", { children: "Run a craft tool that writes a document. The render after each mutating call lands in the preview state directory, and this panel follows it automatically." }), (0, jsx_runtime_1.jsx)("p", { className: "acp-muted", children: "The preview server is reachable; it just has nothing to show." })] }) }));
		}
		/**
		 * The ArtCraft live-preview main panel. Polls `/state`, keeps the last good
		 * snapshot through a transient failure, and can hand the stage to layer B's own
		 * page when a cross-origin read is refused.
		 * @returns the panel surface.
		 */
		function PreviewPanel() {
		    const [view, setView] = (0, react_1.useState)('panel');
		    const [snapshot, setSnapshot] = (0, react_1.useState)(null);
		    const [failure, setFailure] = (0, react_1.useState)(null);
		    const [attempted, setAttempted] = (0, react_1.useState)(false);
		    const [reloadKey, setReloadKey] = (0, react_1.useState)(0);
		    const [selectedCraft, setSelectedCraft] = (0, react_1.useState)(null);
		    const [selectedStep, setSelectedStep] = (0, react_1.useState)(null);
		    const [now, setNow] = (0, react_1.useState)(() => Date.now());
		    const selectedStepElement = (0, react_1.useRef)(null);
		    // One-second clock for the relative timestamps; the data poll is separate.
		    (0, react_1.useEffect)(() => {
		        const timer = window.setInterval(() => { setNow(Date.now()); }, 1000);
		        return () => { window.clearInterval(timer); };
		    }, []);
		    // Poll `/state`; a failure keeps the previous snapshot and only warns.
		    (0, react_1.useEffect)(() => {
		        let disposed = false;
		        let timer;
		        const controller = new AbortController();
		        const poll = async () => {
		            try {
		                const next = await readState(controller.signal);
		                if (disposed)
		                    return;
		                setSnapshot(next);
		                setFailure(null);
		            }
		            catch (cause) {
		                if (disposed || controller.signal.aborted)
		                    return;
		                setFailure(describeError(cause));
		            }
		            finally {
		                if (!disposed) {
		                    setAttempted(true);
		                    timer = window.setTimeout(() => { void poll(); }, POLL_MS);
		                }
		            }
		        };
		        void poll();
		        return () => {
		            disposed = true;
		            controller.abort();
		            if (timer !== undefined)
		                window.clearTimeout(timer);
		        };
		    }, [reloadKey]);
		    const crafts = snapshot?.crafts ?? {};
		    const craftKeys = Object.keys(crafts);
		    const activeKey = selectedCraft !== null && crafts[selectedCraft] !== undefined ? selectedCraft : pickLatest(crafts);
		    const active = activeKey === undefined ? undefined : crafts[activeKey];
		    const steps = active?.steps ?? [];
		    // A new craft starts at its current step, not the previously selected one.
		    (0, react_1.useEffect)(() => { setSelectedStep(null); }, [activeKey]);
		    const currentStepNumber = active?.current ?? (steps.length > 0 ? steps[steps.length - 1]?.n ?? 1 : 1);
		    const currentIndex = Math.max(0, steps.findIndex(step => step.n === currentStepNumber));
		    const currentStep = steps[currentIndex];
		    const shown = selectedStep === null ? currentStep : steps.find(step => step.n === selectedStep) ?? currentStep;
		    const shownIndex = shown === undefined ? -1 : steps.findIndex(step => step.n === shown.n);
		    const timeline = active?.timeline ?? [];
		    // Keep the active row visible when the panel opens on a long step list.
		    (0, react_1.useEffect)(() => {
		        const node = selectedStepElement.current;
		        if (node !== null && view === 'panel')
		            node.scrollIntoView({ block: 'nearest' });
		    }, [currentStepNumber, activeKey, view]);
		    const status = failure !== null
		        ? snapshot === null ? 'down' : 'stale'
		        : snapshot === null ? 'loading' : 'ok';
		    let subtitle;
		    if (view === 'page') {
		        subtitle = `embedding ${PREVIEW_ORIGIN}/`;
		    }
		    else if (active === undefined) {
		        subtitle = snapshot === null ? 'waiting for the preview server' : 'no ArtCraft document yet';
		    }
		    else {
		        const parts = [active.product ?? active.craft];
		        const file = basename(active.file);
		        if (file !== undefined)
		            parts.push(file);
		        parts.push(`${String(steps.length)} step${steps.length === 1 ? '' : 's'}`);
		        const ago = formatAgo(active.updatedAt, now);
		        if (ago !== null)
		            parts.push(`updated ${ago}`);
		        subtitle = parts.join(' · ');
		    }
		    return ((0, jsx_runtime_1.jsxs)("div", { className: "acp-root", children: [(0, jsx_runtime_1.jsxs)("header", { className: "acp-head", children: [(0, jsx_runtime_1.jsx)("span", { className: `acp-dot acp-dot--${status}`, "aria-hidden": "true" }), (0, jsx_runtime_1.jsx)("b", { className: "acp-title", children: "ArtCraft live preview" }), (0, jsx_runtime_1.jsx)("span", { className: "acp-sub", title: failure ?? undefined, children: subtitle }), (0, jsx_runtime_1.jsx)("span", { className: "acp-grow" }), status === 'stale' && (0, jsx_runtime_1.jsx)("span", { className: "acp-chip acp-chip--warn", children: "stale" }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "acp-btn", onClick: () => { setReloadKey(key => key + 1); }, children: "Refresh" }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "acp-btn", onClick: () => { setView(value => value === 'panel' ? 'page' : 'panel'); }, children: view === 'panel' ? 'Raw page' : 'Panel' }), (0, jsx_runtime_1.jsx)("a", { className: "acp-btn", href: `${PREVIEW_ORIGIN}/`, target: "_blank", rel: "noreferrer", children: "Open" })] }), view === 'page'
		                ? ((0, jsx_runtime_1.jsx)("div", { className: "acp-frame-wrap", children: (0, jsx_runtime_1.jsx)("iframe", { className: "acp-frame", src: `${PREVIEW_ORIGIN}/`, title: "ArtCraft live preview (layer B page)" }) }))
		                : snapshot === null
		                    ? (failure === null || !attempted
		                        ? (0, jsx_runtime_1.jsx)(Connecting, {})
		                        : ((0, jsx_runtime_1.jsx)(Unreachable, { message: failure, onRetry: () => { setReloadKey(key => key + 1); }, onShowPage: () => { setView('page'); } })))
		                    : active === undefined
		                        ? (0, jsx_runtime_1.jsx)(Empty, {})
		                        : ((0, jsx_runtime_1.jsxs)("div", { className: "acp-grid", children: [(0, jsx_runtime_1.jsxs)("aside", { className: "acp-card acp-steps", children: [(0, jsx_runtime_1.jsx)("h3", { className: "acp-h3", children: "Agent steps" }), steps.length === 0
		                                            ? (0, jsx_runtime_1.jsx)("p", { className: "acp-muted", children: "The next craft call appends a step here." })
		                                            : ((0, jsx_runtime_1.jsx)("div", { className: "acp-step-list", children: steps.map((step, index) => {
		                                                    const state = index < currentIndex ? 'done' : step.n === currentStepNumber ? 'current' : 'todo';
		                                                    const selected = shown !== undefined && step.n === shown.n;
		                                                    return ((0, jsx_runtime_1.jsxs)("button", { ref: selected ? selectedStepElement : undefined, type: "button", className: `acp-step${selected ? ' acp-step--selected' : ''}${state === 'current' ? ' acp-step--current' : ''}`, onClick: () => { setSelectedStep(step.n); }, children: [(0, jsx_runtime_1.jsx)("span", { className: `acp-n acp-n--${state}`, children: state === 'done' ? '✓' : step.n }), (0, jsx_runtime_1.jsxs)("span", { className: "acp-step-text", children: [(0, jsx_runtime_1.jsx)("span", { className: "acp-step-title", children: step.title ?? `Step ${String(step.n)}` }), (0, jsx_runtime_1.jsx)("span", { className: "acp-step-meta", children: step.summary ?? step.tool ?? formatAgo(step.at, now) ?? '' })] })] }, `${String(step.n)}-${String(index)}`));
		                                                }) })), (0, jsx_runtime_1.jsxs)("div", { className: "acp-chips", children: [(0, jsx_runtime_1.jsxs)("span", { className: "acp-chip acp-chip--ok", children: ["auto-refresh \u00B7 ", String(POLL_MS / 1000), " s"] }), (0, jsx_runtime_1.jsxs)("span", { className: "acp-chip", children: [String(steps.length), " steps"] })] }), craftKeys.length > 1 && ((0, jsx_runtime_1.jsx)("select", { className: "acp-select", value: activeKey ?? '', "aria-label": "Craft", onChange: (event) => { setSelectedCraft(event.target.value); }, children: craftKeys.map(key => ((0, jsx_runtime_1.jsx)("option", { value: key, children: crafts[key]?.product ?? key }, key))) }))] }), (0, jsx_runtime_1.jsxs)("section", { className: "acp-card acp-canvas", children: [(0, jsx_runtime_1.jsxs)("h3", { className: "acp-h3", children: ["Current render", shown === undefined ? '' : ` · ${active.craft} step ${String(shown.n)}`] }), (0, jsx_runtime_1.jsx)("div", { className: "acp-shot", children: shown !== undefined && shown.image !== undefined
		                                                ? ((0, jsx_runtime_1.jsx)("img", { className: "acp-img", src: imageUrl(active.craft, shown.image), alt: `${active.product ?? active.craft} step ${String(shown.n)} render` }))
		                                                : ((0, jsx_runtime_1.jsx)("div", { className: "acp-shot-empty", children: shown === undefined ? 'No render yet' : 'This step has no rendered image' })) }), (0, jsx_runtime_1.jsxs)("div", { className: "acp-cap", children: [(0, jsx_runtime_1.jsx)("span", { children: shown === undefined
		                                                        ? 'no step selected'
		                                                        : [
		                                                            `step ${String(shown.n)} of ${String(steps.length)}`,
		                                                            active.pages === undefined ? undefined : `page 1/${String(active.pages)}`,
		                                                            shown.width === undefined || shown.height === undefined
		                                                                ? undefined
		                                                                : `${String(shown.width)}×${String(shown.height)}`,
		                                                        ].filter(part => part !== undefined).join(' · ') }), (0, jsx_runtime_1.jsx)("span", { children: shown === undefined ? '' : formatAgo(shown.at, now) ?? '' })] }), (0, jsx_runtime_1.jsx)("div", { className: "acp-filmstrip", children: steps.map((step, index) => {
		                                                const selected = shown !== undefined && step.n === shown.n;
		                                                const thumb = step.thumb ?? step.image;
		                                                return ((0, jsx_runtime_1.jsx)("button", { type: "button", className: `acp-thumb${selected ? ' acp-thumb--active' : ''}`, title: `Step ${String(step.n)}${step.title === undefined ? '' : ` · ${step.title}`}`, onClick: () => { setSelectedStep(step.n); }, children: thumb !== undefined
		                                                        ? (0, jsx_runtime_1.jsx)("img", { src: imageUrl(active.craft, thumb), alt: "", loading: "lazy" })
		                                                        : (0, jsx_runtime_1.jsx)("span", { children: step.n }) }, `${String(step.n)}-thumb-${String(index)}`));
		                                            }) })] }), (0, jsx_runtime_1.jsxs)("aside", { className: "acp-card acp-meta", children: [(0, jsx_runtime_1.jsx)("h3", { className: "acp-h3", children: "Document" }), (0, jsx_runtime_1.jsx)(Kv, { label: "craft", value: active.product ?? active.craft }), (0, jsx_runtime_1.jsx)(Kv, { label: "file", value: basename(active.file) ?? '—' }), (0, jsx_runtime_1.jsx)(Kv, { label: "pages", value: active.pages ?? '—' }), (0, jsx_runtime_1.jsx)(Kv, { label: "last op", value: shown?.tool ?? '—' }), (0, jsx_runtime_1.jsx)(Kv, { label: "duration", value: formatDuration(shown?.durationMs) }), (0, jsx_runtime_1.jsx)(Kv, { label: "step", value: shown === undefined ? '—' : `${String(shownIndex + 1)} / ${String(steps.length)}` }), timeline.length > 0 && ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("h3", { className: "acp-h3 acp-h3--gap", children: "Timeline" }), (0, jsx_runtime_1.jsx)(Timeline, { segments: timeline }), (0, jsx_runtime_1.jsx)("div", { className: "acp-timeline-rows", children: timeline.map((segment, index) => ((0, jsx_runtime_1.jsxs)("div", { className: "acp-kv", children: [(0, jsx_runtime_1.jsxs)("span", { children: [segment.label, " \u00B7 ", formatSeconds(segment.duration)] }), (0, jsx_runtime_1.jsx)("b", { className: "acp-ok", children: "\u2713" })] }, `${segment.label}-${String(index)}`))) })] }))] })] }))] }));
		}
		// ── plugin body ─────────────────────────────────────────────────────────────
		/**
		 * Contribute the panel and its sidebar launcher. `slots.inject` waits for each
		 * slot's declaration, so registration survives either plugin's activation
		 * order; the returned disposers are owned by this plugin's fiber.
		 * @param ctx - browser context carrying the slot registry.
		 */
		function apply(ctx) {
		    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, PreviewPanel));
		    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
		        name: 'sidebar.panellist',
		        id: PANEL_ID,
		        order: 30,
		        label: PANEL_LABEL,
		    }, PreviewIcon));
		}
		// ── styles ──────────────────────────────────────────────────────────────────
		/**
		 * Self-contained dark surface: a preview stage reads as media, so the panel
		 * keeps its own palette instead of borrowing the host theme's raised layers.
		 * Injected once per materialization and tagged for the loader's HMR cleanup.
		 */
		const PANEL_CSS = `
		.acp-root {
		  --acp-bg: #0b0d12;
		  --acp-panel: #121620;
		  --acp-line: #222a38;
		  --acp-text: #e8ecf4;
		  --acp-dim: #8794aa;
		  --acp-accent: #5b8cff;
		  --acp-ok: #38c172;
		  --acp-warn: #e0a84a;
		  --acp-danger: #e05a5a;
		  position: relative;
		  display: flex;
		  flex-direction: column;
		  width: 100%;
		  height: 100%;
		  min-width: 0;
		  min-height: 0;
		  overflow: hidden;
		  color: var(--acp-text);
		  background: var(--acp-bg);
		  font: 13px/1.5 -apple-system, "SF Pro Text", "PingFang SC", system-ui, sans-serif;
		  color-scheme: dark;
		}
		.acp-head {
		  display: flex;
		  align-items: center;
		  gap: 10px;
		  flex: none;
		  padding: 12px 18px;
		  border-bottom: 1px solid var(--acp-line);
		}
		.acp-dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--acp-dim); }
		.acp-dot--ok { background: var(--acp-ok); box-shadow: 0 0 10px var(--acp-ok); }
		.acp-dot--stale { background: var(--acp-warn); box-shadow: 0 0 10px rgb(224 168 74 / 45%); }
		.acp-dot--down { background: var(--acp-danger); box-shadow: 0 0 10px rgb(224 90 90 / 45%); }
		.acp-dot--loading { animation: acp-pulse 1.2s ease-in-out infinite; }
		.acp-title { font-size: 14px; white-space: nowrap; }
		.acp-sub { color: var(--acp-dim); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
		.acp-grow { flex: 1 1 auto; }
		.acp-btn {
		  appearance: none;
		  flex: none;
		  padding: 4px 10px;
		  border: 1px solid var(--acp-line);
		  border-radius: 8px;
		  color: var(--acp-text);
		  background: #161c28;
		  font: inherit;
		  font-size: 12px;
		  line-height: 18px;
		  text-decoration: none;
		  cursor: pointer;
		}
		.acp-btn:hover { background: #1c2433; border-color: #2b3a57; }
		.acp-btn:focus-visible { outline: 2px solid var(--acp-accent); outline-offset: 2px; }
		.acp-btn--primary { background: var(--acp-accent); border-color: var(--acp-accent); color: #fff; }
		.acp-btn--primary:hover { background: #6f9bff; border-color: #6f9bff; }
		.acp-chip {
		  display: inline-block;
		  padding: 2px 8px;
		  border: 1px solid var(--acp-line);
		  border-radius: 999px;
		  color: var(--acp-dim);
		  font-size: 11px;
		  white-space: nowrap;
		}
		.acp-chip--ok { color: var(--acp-ok); border-color: #22573a; }
		.acp-chip--warn { color: var(--acp-warn); border-color: #5b4622; }
		.acp-grid {
		  display: grid;
		  grid-template-columns: minmax(200px, 260px) minmax(0, 1fr) minmax(180px, 216px);
		  flex: 1 1 auto;
		  gap: 14px;
		  min-height: 0;
		  padding: 14px 18px;
		}
		.acp-card {
		  display: flex;
		  flex-direction: column;
		  min-width: 0;
		  min-height: 0;
		  padding: 12px;
		  border: 1px solid var(--acp-line);
		  border-radius: 12px;
		  background: var(--acp-panel);
		}
		.acp-h3 {
		  flex: none;
		  margin: 0 0 10px;
		  color: var(--acp-dim);
		  font-size: 11px;
		  font-weight: 600;
		  letter-spacing: 0.1em;
		  text-transform: uppercase;
		}
		.acp-h3--gap { margin-top: 14px; }
		.acp-steps { overflow: hidden; }
		.acp-step-list { display: flex; flex-direction: column; gap: 4px; min-height: 0; overflow: auto; scrollbar-width: thin; }
		.acp-step {
		  display: flex;
		  flex: none;
		  gap: 9px;
		  align-items: flex-start;
		  width: 100%;
		  padding: 8px;
		  border: 1px solid transparent;
		  border-radius: 9px;
		  color: inherit;
		  background: transparent;
		  font: inherit;
		  text-align: left;
		  cursor: pointer;
		}
		.acp-step:hover { background: #161d2b; }
		.acp-step:focus-visible { outline: 2px solid var(--acp-accent); outline-offset: 1px; }
		.acp-step--selected { background: #182031; border-color: #2b3a57; }
		.acp-n {
		  display: grid;
		  place-items: center;
		  flex: 0 0 20px;
		  width: 20px;
		  height: 20px;
		  border-radius: 50%;
		  color: var(--acp-dim);
		  background: #1d2534;
		  font-size: 10.5px;
		  font-weight: 700;
		}
		.acp-n--current { background: var(--acp-accent); color: #fff; }
		.acp-n--done { color: var(--acp-ok); }
		.acp-step-text { display: flex; flex-direction: column; min-width: 0; }
		.acp-step-title { font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.acp-step-meta { color: var(--acp-dim); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.acp-chips { display: flex; flex: none; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
		.acp-select {
		  flex: none;
		  margin-top: 8px;
		  padding: 4px 6px;
		  border: 1px solid var(--acp-line);
		  border-radius: 8px;
		  color: var(--acp-text);
		  background: #161c28;
		  font: inherit;
		  font-size: 12px;
		}
		.acp-canvas { overflow: hidden; }
		.acp-shot {
		  display: grid;
		  place-items: center;
		  flex: 1 1 auto;
		  min-height: 220px;
		  padding: 14px;
		  overflow: hidden;
		  border: 1px solid var(--acp-line);
		  border-radius: 10px;
		  background: #0d1119;
		}
		.acp-img { max-width: 100%; max-height: 100%; border-radius: 6px; box-shadow: 0 10px 30px rgb(0 0 0 / 45%); object-fit: contain; }
		.acp-shot-empty { color: var(--acp-dim); font-size: 12px; text-align: center; }
		.acp-cap { display: flex; flex: none; justify-content: space-between; gap: 10px; margin-top: 9px; color: var(--acp-dim); font-size: 11.5px; }
		.acp-cap span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.acp-filmstrip { display: flex; flex: none; gap: 8px; margin-top: 10px; padding-bottom: 2px; overflow-x: auto; scrollbar-width: thin; }
		.acp-thumb {
		  display: grid;
		  place-items: center;
		  flex: 0 0 104px;
		  width: 104px;
		  height: 59px;
		  padding: 0;
		  overflow: hidden;
		  border: 1px solid var(--acp-line);
		  border-radius: 6px;
		  color: var(--acp-dim);
		  background: #0d1119;
		  font: inherit;
		  font-size: 11px;
		  cursor: pointer;
		}
		.acp-thumb:hover { border-color: #2b3a57; }
		.acp-thumb--active { border-color: var(--acp-accent); box-shadow: 0 0 0 1px var(--acp-accent); }
		.acp-thumb img { width: 100%; height: 100%; object-fit: cover; object-position: top; }
		.acp-meta { overflow: auto; scrollbar-width: thin; }
		.acp-kv { display: flex; flex: none; justify-content: space-between; gap: 8px; font-size: 11.5px; color: var(--acp-dim); }
		.acp-kv b { max-width: 62%; overflow: hidden; color: var(--acp-text); font-weight: 600; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
		.acp-ok { color: var(--acp-ok); }
		.acp-timeline { position: relative; flex: none; height: 34px; overflow: hidden; border: 1px solid var(--acp-line); border-radius: 8px; background: #0d1119; }
		.acp-seg { position: absolute; top: 0; bottom: 0; border-right: 1px solid #0d1119; }
		.acp-seg--a { background: linear-gradient(180deg, #2a4a8f, #1d3468); }
		.acp-seg--b { background: linear-gradient(180deg, #3b7d5a, #256045); }
		.acp-ticks { position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: space-between; padding: 0 6px; color: var(--acp-dim); font-size: 9.5px; pointer-events: none; }
		.acp-timeline-rows { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
		.acp-center { display: grid; place-items: center; flex: 1 1 auto; min-height: 0; padding: 24px; overflow: auto; }
		.acp-center-title { margin: 12px 0 0; font-size: 13px; font-weight: 600; }
		.acp-muted { color: var(--acp-dim); font-size: 12px; }
		.acp-mono { font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace; font-size: 11.5px; }
		.acp-spinner { width: 20px; height: 20px; border: 2px solid var(--acp-line); border-top-color: var(--acp-accent); border-radius: 50%; animation: acp-spin 0.9s linear infinite; }
		.acp-notice, .acp-empty { width: min(560px, 100%); padding: 22px; border: 1px solid var(--acp-line); border-radius: 12px; background: var(--acp-panel); }
		.acp-notice h2, .acp-empty h2 { margin: 0 0 10px; font-size: 15px; }
		.acp-notice p, .acp-empty p { margin: 0 0 10px; color: var(--acp-dim); font-size: 12.5px; }
		.acp-notice ol { margin: 0 0 14px; padding-left: 20px; color: var(--acp-dim); font-size: 12.5px; }
		.acp-notice li { margin-bottom: 6px; }
		.acp-notice code, .acp-empty code { padding: 1px 5px; border: 1px solid var(--acp-line); border-radius: 5px; background: #0d1119; font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace; font-size: 11px; }
		.acp-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
		.acp-empty-mark { color: var(--acp-accent); font-size: 28px; line-height: 1; }
		.acp-frame-wrap { flex: 1 1 auto; min-height: 0; }
		.acp-frame { display: block; width: 100%; height: 100%; border: 0; background: #0d1119; }
		@keyframes acp-spin { to { transform: rotate(360deg); } }
		@keyframes acp-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
		@media (max-width: 980px) {
		  .acp-grid { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(120px, auto) minmax(0, 1fr); overflow: auto; }
		  .acp-meta { max-height: 220px; }
		  .acp-canvas { min-height: 320px; }
		}
		@media (prefers-reduced-motion: reduce) {
		  .acp-spinner, .acp-dot--loading { animation: none; }
		}
		`;
		/**
		 * Inject the panel stylesheet once per materialization, tagged the way the
		 * client loader expects so HMR cleanup removes it with the plugin bundle.
		 */
		function installStyles() {
		    if (typeof document === 'undefined')
		        return;
		    if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null)
		        return;
		    const tag = document.createElement('style');
		    tag.dataset.plugin = 'dsh-artcraft-preview-panel';
		    tag.dataset.pluginCss = STYLE_ID;
		    tag.textContent = PANEL_CSS;
		    document.head.appendChild(tag);
		}
		installStyles();
		return module.exports;
	},
});
