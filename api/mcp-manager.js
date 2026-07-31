/**
 * @file api/mcp-manager.js
 * @description MCP (Model Context Protocol) integration layer for "עויזר צ'אט".
 * @version 3.0.0 — Full MCP initialize handshake + all 10 Israeli MCP servers.
 *
 * Architecture:
 *   Gemini -> index.js -> MCPManager.buildContextForQuery() -> [MCP Servers]
 *
 * Supported servers (all confirmed npm packages on Vercel Node.js runtime):
 *   stdio (npx):
 *     - @skills-il/israel-railways-mcp   (רכבת ישראל)
 *     - @skills-il/openbus-mcp           (אוטובוסים בזמן אמת)
 *     - @skills-il/israel-hiking-mcp     (שבילי טיול)
 *     - @skills-il/israel-nature-mcp     (טבע ישראל)
 *     - @skills-il/israel-vehicles-mcp   (מאגר כלי רכב)
 *     - @skills-il/ben-gurion-flights-mcp (טיסות נתב"ג)
 *     - @hebcal/mcp                      (לוח עברי)
 *
 *   Python / git-based servers (NOT runnable on Vercel Node — graceful skip):
 *     - sefaria (uvx git+https://...)    -> skipped, marked pythonOnly
 *     - ims-mcp (python -m ims_mcp)      -> skipped, marked pythonOnly
 *     - routes-mcp-israel (uv run)       -> skipped, marked pythonOnly
 *
 * IMPORTANT: MCP stdio servers require a proper initialize→initialized handshake
 * before any tools/call. This version implements the full handshake.
 *
 * Requires Node.js runtime (export const runtime = 'nodejs' in index.js) — already set.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve as pathResolve } from 'node:path';

// Verify module loaded — should appear in Vercel Runtime Logs on every cold start
console.log("[MCP] mcp-manager.js loaded — Node.js runtime:", process.version);

// Helper: resolve the bin path of an installed MCP package from node_modules
// Falls back to `npx -y <pkg>` if local binary is not found.
function resolveMCPCommand(npmPackage) {
    try {
        const require = createRequire(import.meta.url);
        const pkgJson = require(`${npmPackage}/package.json`);
        const binEntry = pkgJson.bin;
        if (binEntry) {
            const binPath = typeof binEntry === 'string' ? binEntry : Object.values(binEntry)[0];
            // Resolve relative to the package root
            const pkgRoot = pathResolve(require.resolve(`${npmPackage}/package.json`), '..');
            const absPath = pathResolve(pkgRoot, binPath);
            return { cmd: "node", args: [absPath] };
        }
    } catch (_) {}
    // Fallback: use npx (will download if not cached — slow on cold start)
    return { cmd: "npx", args: ["-y", npmPackage] };
}

// ============================================================================
// PART 0: CONFIGURATION
// ============================================================================

const MCP_CONFIG = {
    TIMEOUT_MS: 25000,         // per MCP call (initialize + tools/call combined; npx cold-starts need ~10-20s)
    RETRY_ATTEMPTS_PER_DOMAIN: 2,
    CACHE_TTL_MS: {
        weather: 5 * 60 * 1000,
        transit: 30 * 1000,
        hiking: 24 * 60 * 60 * 1000,
        flights: 60 * 1000,
        jewish_calendar: 60 * 60 * 1000,
        jewish_texts: 24 * 60 * 60 * 1000,
        vehicles: 60 * 60 * 1000,
        nature: 60 * 60 * 1000,
        emergency: 15 * 1000,
        business: 60 * 60 * 1000,
    },
    SERVERS: {
        // ---- stdio (npm / npx) ----
        ISRAEL_RAILWAYS: {
            name: "רכבת ישראל",
            transport: "stdio",
            npmPackage: "@skills-il/israel-railways-mcp",
            // Real tools: search_routes (from, to, date, hour), list_stations (filter), get_service_updates ()
            defaultTool: "get_service_updates",
        },
        OPENBUS: {
            name: "אוטובוסים בזמן אמת",
            transport: "stdio",
            npmPackage: "@skills-il/openbus-mcp",
            // Real tools: get_stop_arrivals, search_routes, find_stops, get_ride_performance,
            //             get_route_timetable, get_vehicle_locations, list_agencies
            defaultTool: "get_stop_arrivals",
        },
        ISRAEL_HIKING: {
            name: "שבילי טיול בישראל",
            transport: "stdio",
            npmPackage: "@skills-il/israel-hiking-mcp",
            defaultTool: "search_trails",
        },
        ISRAEL_NATURE: {
            name: "טבע ישראל",
            transport: "stdio",
            npmPackage: "@skills-il/israel-nature-mcp",
            defaultTool: "search_observations",
        },
        ISRAEL_VEHICLES: {
            name: "מאגר כלי רכב ישראלי",
            transport: "stdio",
            npmPackage: "@skills-il/israel-vehicles-mcp",
            defaultTool: "search_vehicle",
        },
        BEN_GURION_FLIGHTS: {
            name: "טיסות נתב\"ג",
            transport: "stdio",
            npmPackage: "@skills-il/ben-gurion-flights-mcp",
            defaultTool: "get_flights",
        },
        HEBCAL: {
            name: "לוח עברי",
            transport: "stdio",
            npmPackage: "@hebcal/mcp",
            defaultTool: "get_holidays",
        },
        // ---- Python-only (skip gracefully on Vercel) ----
        SEFARIA: {
            name: "ספריא",
            transport: "stdio",
            pythonOnly: true, // uvx git+https://... — cannot run on Vercel Node
            npmPackage: null,
            defaultTool: "get_text",
        },
        IMS_WEATHER: {
            name: "מזג אוויר ישראל (IMS)",
            transport: "stdio",
            pythonOnly: true, // python -m ims_mcp.server — cannot run on Vercel Node
            npmPackage: null,
            defaultTool: "get_forecast",
        },
        ROUTES_ISRAEL: {
            name: "מסלולים ישראל",
            transport: "stdio",
            pythonOnly: true, // uv run server.py — cannot run on Vercel Node
            npmPackage: null,
            defaultTool: "plan_route",
        },
    },
};

// ============================================================================
// PART 1: LOGGER
// ============================================================================

class MCPLogger {
    static _fmt(level, tag, msg, extra) {
        const ts = new Date().toISOString();
        const base = `[${ts}] [MCP:${level}] [${tag}] ${msg}`;
        return extra !== undefined ? `${base} :: ${JSON.stringify(extra)}` : base;
    }
    static info(tag, msg, extra) { console.log(this._fmt("INFO", tag, msg, extra)); }
    static warn(tag, msg, extra) { console.warn(this._fmt("WARN", tag, msg, extra)); }
    static error(tag, msg, extra) { console.error(this._fmt("ERROR", tag, msg, extra)); }
}

// ============================================================================
// PART 2: IN-MEMORY TTL CACHE
// ============================================================================

class MCPCache {
    static _store = new Map();

    static _key(domain, key) { return `${domain}::${key}`; }

    static get(domain, key) {
        const k = this._key(domain, key);
        const entry = this._store.get(k);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) { this._store.delete(k); return null; }
        return entry.value;
    }

    static set(domain, key, value, ttlMs) {
        this._store.set(this._key(domain, key), { value, expiresAt: Date.now() + ttlMs });
    }
}

// ============================================================================
// PART 3: STDIO MCP TRANSPORT (with proper initialize handshake)
// ============================================================================

/**
 * Calls a stdio MCP server via npx.
 * Protocol: initialize -> (wait for initialized notification) -> tools/call -> read result -> kill.
 *
 * Many community MCP servers use @modelcontextprotocol/sdk which REQUIRES the full
 * initialize handshake; sending tools/call without it causes the server to ignore
 * the request or close stdin immediately.
 */
async function callMCPStdio(serverConfig, toolName, toolArgs) {
    if (serverConfig.pythonOnly) {
        throw new Error(`${serverConfig.name} requires Python runtime — not available on Vercel Node.js`);
    }
    if (!serverConfig.npmPackage) {
        throw new Error(`No npm package configured for ${serverConfig.name}`);
    }
    if (typeof spawn !== "function") {
        throw new Error(`stdio transport unavailable — Node.js child_process not accessible`);
    }

    const start = Date.now();
    const { cmd, args } = resolveMCPCommand(serverConfig.npmPackage);
    MCPLogger.info(serverConfig.name, `Resolved command: ${cmd} ${args.join(' ')}`);

    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            stdio: ["pipe", "pipe", "pipe"],
        });

        let stdoutBuf = "";
        let stderrBuf = "";
        let settled = false;
        let initializeDone = false;
        let toolCallId = null;

        const timeoutId = setTimeout(() => {
            if (!settled) {
                settled = true;
                try { child.kill("SIGKILL"); } catch (_) {}
                reject(new Error(`Timeout (${MCP_CONFIG.TIMEOUT_MS}ms) calling ${serverConfig.name} tool=${toolName}`));
            }
        }, MCP_CONFIG.TIMEOUT_MS);

        const done = (fn, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            try { child.kill("SIGKILL"); } catch (_) {}
            fn(value);
        };

        const sendMsg = (obj) => {
            try {
                child.stdin.write(JSON.stringify(obj) + "\n");
            } catch (e) {
                done(reject, new Error(`stdin write failed: ${e.message}`));
            }
        };

        const processLine = (line) => {
            const trimmed = line.trim();
            if (!trimmed) return;
            let msg;
            try { msg = JSON.parse(trimmed); } catch (_) { return; }

            // Server → Client: initialize response (id matches our initialize request)
            if (!initializeDone && msg.id === "init-1" && msg.result !== undefined) {
                initializeDone = true;
                // Send initialized notification (no id = notification)
                sendMsg({ jsonrpc: "2.0", method: "notifications/initialized" });
                // Now send the actual tools/call
                toolCallId = `tool-${Date.now()}`;
                sendMsg({
                    jsonrpc: "2.0",
                    id: toolCallId,
                    method: "tools/call",
                    params: { name: toolName, arguments: toolArgs || {} },
                });
                return;
            }

            // Server → Client: tools/call response
            if (msg.id === toolCallId) {
                if (msg.error) {
                    done(reject, new Error(`MCP tool error: ${JSON.stringify(msg.error)}`));
                } else {
                    done(resolve, msg.result);
                }
                return;
            }

            // Server → Client: error on initialize or unknown
            if (msg.error && msg.id === "init-1") {
                done(reject, new Error(`MCP initialize error: ${JSON.stringify(msg.error)}`));
            }
        };

        child.stdout.on("data", (chunk) => {
            stdoutBuf += chunk.toString("utf8");
            const lines = stdoutBuf.split("\n");
            // Keep the last potentially incomplete line in the buffer
            stdoutBuf = lines.pop();
            for (const line of lines) processLine(line);
        });

        child.stderr.on("data", (chunk) => { stderrBuf += chunk.toString("utf8"); });

        child.on("error", (err) => done(reject, err));

        child.on("close", (code) => {
            // Flush any remaining buffered stdout
            if (stdoutBuf.trim()) processLine(stdoutBuf);
            if (!settled) {
                done(reject, new Error(
                    `${serverConfig.name} exited (code=${code}) before responding. ` +
                    `stderr: ${stderrBuf.slice(0, 400)}`
                ));
            }
        });

        // Step 1: Send initialize handshake
        sendMsg({
            jsonrpc: "2.0",
            id: "init-1",
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: { roots: { listChanged: true }, sampling: {} },
                clientInfo: { name: "oizer-chat-ivr", version: "3.0.0" },
            },
        });

        MCPLogger.info(serverConfig.name, `Spawned (stdio). tool=${toolName}`, { args: toolArgs });
    }).then(result => {
        MCPLogger.info(serverConfig.name, `Success in ${Date.now() - start}ms`, { toolName });
        return result;
    }).catch(e => {
        MCPLogger.warn(serverConfig.name, `Failed after ${Date.now() - start}ms: ${e.message}`, { toolName });
        throw e;
    });
}

// ============================================================================
// PART 4: PROVIDERS (one per domain)
// ============================================================================

class TransitProvider {
    static async getTransitInfo({ origin, destination, subtype, line, station }) {
        const today = new Date().toISOString().split("T")[0];
        const cacheKey = `${subtype || "trip"}::${origin || ""}::${destination || ""}::${line || ""}::${station || ""}`;
        const cached = MCPCache.get("transit", cacheKey);
        if (cached) return cached;

        let result = null;

        // --- Train: use israel-railways-mcp ---
        if (subtype === "train" || (!subtype && (origin || destination))) {
            try {
                // get_service_updates requires no args — always useful
                const updates = await callMCPStdio(MCP_CONFIG.SERVERS.ISRAEL_RAILWAYS, "get_service_updates", {});
                // search_routes: args are from, to, date, hour
                const routes = await callMCPStdio(MCP_CONFIG.SERVERS.ISRAEL_RAILWAYS, "search_routes", {
                    from: origin || "",
                    to: destination || "",
                    date: today,
                }).catch(() => null);

                // Combine both results
                const parts = [];
                if (updates) parts.push(MCPResponseFormatter.format("transit", updates));
                if (routes)  parts.push(MCPResponseFormatter.format("transit", routes));
                if (parts.filter(Boolean).length > 0) {
                    result = { content: [{ type: "text", text: parts.filter(Boolean).join("\n\n") }] };
                }
            } catch (e) {
                MCPLogger.warn("TransitProvider", `Railways MCP failed: ${e.message}`);
            }
        }

        // --- Bus: use openbus-mcp ---
        // Strategy: if station (GTFS stop code) is given -> get_stop_arrivals directly
        //           if city is given -> find_stops first, then get_stop_arrivals for first result
        //           if line name is given -> search_routes first
        if (subtype === "bus" || (!result && subtype !== "train")) {
            try {
                // station can come from _extractStationNumber (already digits after normalization)
                const stationId = station && /^\d+$/.test(String(station)) ? parseInt(station, 10) : null;
                if (stationId) {
                    // Direct arrival lookup by GTFS stop ID
                    MCPLogger.info("TransitProvider", `get_stop_arrivals for stop ${stationId}${line ? ` line ${line}` : ""}`);
                    result = await callMCPStdio(MCP_CONFIG.SERVERS.OPENBUS, "get_stop_arrivals", {
                        gtfs_stop_id: stationId,
                        limit: 10,
                    });
                } else if (line) {
                    // Find routes matching this line short name
                    result = await callMCPStdio(MCP_CONFIG.SERVERS.OPENBUS, "search_routes", {
                        route_short_name: String(line),
                        date_from: today,
                        date_to: today,
                        limit: 5,
                    });
                } else if (origin) {
                    // Find stops in the city the user mentioned
                    const stopsResult = await callMCPStdio(MCP_CONFIG.SERVERS.OPENBUS, "find_stops", {
                        city: origin,
                        limit: 3,
                    });
                    // If we found stops, get arrivals for the first one
                    if (stopsResult && Array.isArray(stopsResult.content)) {
                        const text = stopsResult.content.filter(c => c.type === "text").map(c => c.text).join("");
                        const stopIdMatch = text.match(/"stop_id"\s*:\s*(\d+)/);
                        if (stopIdMatch) {
                            const arrivals = await callMCPStdio(MCP_CONFIG.SERVERS.OPENBUS, "get_stop_arrivals", {
                                gtfs_stop_id: parseInt(stopIdMatch[1], 10),
                                limit: 10,
                            }).catch(() => null);
                            const combined = [
                                MCPResponseFormatter.format("transit", stopsResult),
                                arrivals ? MCPResponseFormatter.format("transit", arrivals) : null,
                            ].filter(Boolean).join("\n\n");
                            result = { content: [{ type: "text", text: combined }] };
                        } else {
                            result = stopsResult;
                        }
                    } else {
                        result = stopsResult;
                    }
                } else {
                    // Fallback: list agencies so Gemini can at least mention them
                    result = await callMCPStdio(MCP_CONFIG.SERVERS.OPENBUS, "list_agencies", {
                        date_from: today,
                        limit: 20,
                    });
                }
            } catch (e) {
                MCPLogger.warn("TransitProvider", `OpenBus MCP failed: ${e.message}`);
            }
        }

        if (!result) throw new Error("All transit providers failed");
        MCPCache.set("transit", cacheKey, result, MCP_CONFIG.CACHE_TTL_MS.transit);
        return result;
    }
}

class HikingProvider {
    static async getTrailInfo({ area, feature }) {
        const cacheKey = `${area || "any"}::${feature || "trail"}`;
        const cached = MCPCache.get("hiking", cacheKey);
        if (cached) return cached;

        const result = await callMCPStdio(MCP_CONFIG.SERVERS.ISRAEL_HIKING, "search_trails", {
            area: area || "",
            feature: feature || "",
        });
        MCPCache.set("hiking", cacheKey, result, MCP_CONFIG.CACHE_TTL_MS.hiking);
        return result;
    }
}

class FlightsProvider {
    static async getFlights({ direction, airline, destination }) {
        const cacheKey = `${direction || "both"}::${airline || ""}::${destination || ""}`;
        const cached = MCPCache.get("flights", cacheKey);
        if (cached) return cached;

        const result = await callMCPStdio(MCP_CONFIG.SERVERS.BEN_GURION_FLIGHTS, "get_flights", {
            direction: direction || "both",
            airline: airline || "",
            destination: destination || "",
        });
        MCPCache.set("flights", cacheKey, result, MCP_CONFIG.CACHE_TTL_MS.flights);
        return result;
    }
}

class JewishCalendarProvider {
    static async getInfo({ query, location, date }) {
        const cacheKey = `${query || "today"}::${location || ""}::${date || ""}`;
        const cached = MCPCache.get("jewish_calendar", cacheKey);
        if (cached) return cached;

        // Try holidays first, then parasha if holidays gives nothing useful
        const result = await callMCPStdio(MCP_CONFIG.SERVERS.HEBCAL, "get_holidays", {
            year: new Date().getFullYear(),
            location: location || "IL",
        }).catch(() => callMCPStdio(MCP_CONFIG.SERVERS.HEBCAL, "get_parasha", {
            date: date || new Date().toISOString().split("T")[0],
            diaspora: false,
        }));

        MCPCache.set("jewish_calendar", cacheKey, result, MCP_CONFIG.CACHE_TTL_MS.jewish_calendar);
        return result;
    }
}

class VehiclesProvider {
    static async getVehicle({ plateNumber, manufacturer, model }) {
        const cacheKey = `${plateNumber || ""}::${manufacturer || ""}::${model || ""}`;
        const cached = MCPCache.get("vehicles", cacheKey);
        if (cached) return cached;

        const result = await callMCPStdio(MCP_CONFIG.SERVERS.ISRAEL_VEHICLES, "search_vehicle", {
            license_plate: plateNumber || "",
            manufacturer: manufacturer || "",
            model: model || "",
        });
        MCPCache.set("vehicles", cacheKey, result, MCP_CONFIG.CACHE_TTL_MS.vehicles);
        return result;
    }
}

class NatureProvider {
    static async getObservations({ area, species }) {
        const cacheKey = `${area || ""}::${species || ""}`;
        const cached = MCPCache.get("nature", cacheKey);
        if (cached) return cached;

        const result = await callMCPStdio(MCP_CONFIG.SERVERS.ISRAEL_NATURE, "search_observations", {
            location: area || "",
            species: species || "",
        });
        MCPCache.set("nature", cacheKey, result, MCP_CONFIG.CACHE_TTL_MS.nature);
        return result;
    }
}

// Python-only providers — always return graceful unavailable result
class JewishTextsProvider {
    static async getText() {
        throw new Error("ספריא MCP requires Python (uvx) — not available on Vercel Node.js");
    }
}

class WeatherProvider {
    static async getWeather() {
        throw new Error("IMS Weather MCP requires Python — not available on Vercel Node.js. Use Gemini's built-in knowledge.");
    }
}

// ============================================================================
// PART 4b: HEBREW NUMBER CONVERTER
// Converts STT spoken numbers (e.g. "שש מאות וחמש עשרה") to digits ("615").
// This is critical because Yemot STT always returns numbers as Hebrew words.
// ============================================================================

const HEB_NUM_MAP = {
    "אחד": 1, "אחת": 1,
    "שניים": 2, "שתיים": 2, "שני": 2, "שתי": 2,
    "שלושה": 3, "שלוש": 3,
    "ארבעה": 4, "ארבע": 4,
    "חמישה": 5, "חמש": 5,
    "שישה": 6, "שש": 6,
    "שבעה": 7, "שבע": 7,
    "שמונה": 8,
    "תשעה": 9, "תשע": 9,
    "עשרה": 10, "עשר": 10,
    "אחד עשר": 11, "אחת עשרה": 11,
    "שנים עשר": 12, "שתים עשרה": 12,
    "שלושה עשר": 13, "שלוש עשרה": 13,
    "ארבעה עשר": 14, "ארבע עשרה": 14,
    "חמישה עשר": 15, "חמש עשרה": 15,
    "שישה עשר": 16, "שש עשרה": 16,
    "שבעה עשר": 17, "שבע עשרה": 17,
    "שמונה עשר": 18, "שמונה עשרה": 18,
    "תשעה עשר": 19, "תשע עשרה": 19,
    "עשרים": 20,
    "שלושים": 30,
    "ארבעים": 40,
    "חמישים": 50,
    "שישים": 60,
    "שבעים": 70,
    "שמונים": 80,
    "תשעים": 90,
    "מאה": 100,
    "מאתיים": 200,
    "שלש מאות": 300, "שלוש מאות": 300,
    "ארבע מאות": 400,
    "חמש מאות": 500,
    "שש מאות": 600,
    "שבע מאות": 700,
    "שמונה מאות": 800,
    "תשע מאות": 900,
    "אלף": 1000,
};

// Parse a Hebrew number phrase like "שש מאות וחמש עשרה" → 615
function parseHebrewNumber(phrase) {
    if (!phrase) return null;
    const p = phrase.trim().replace(/\bו/g, " ").replace(/\s+/g, " ").toLowerCase();
    let total = 0;
    let current = 0;
    // Sort keys longest-first so multi-word entries match before single words
    const sorted = Object.keys(HEB_NUM_MAP).sort((a, b) => b.length - a.length);
    let remaining = p;
    while (remaining.trim()) {
        let matched = false;
        for (const key of sorted) {
            if (remaining.startsWith(key)) {
                const val = HEB_NUM_MAP[key];
                if (val >= 100) {
                    // "מאה", "מאתיים", "שש מאות" etc. — multiply current if set, else add
                    if (current > 0) {
                        total += current * val;
                        current = 0;
                    } else {
                        total += val;
                    }
                } else {
                    current += val;
                }
                remaining = remaining.slice(key.length).trim();
                matched = true;
                break;
            }
        }
        if (!matched) {
            // skip one word
            const spaceIdx = remaining.indexOf(" ");
            remaining = spaceIdx === -1 ? "" : remaining.slice(spaceIdx + 1).trim();
        }
    }
    total += current;
    return total > 0 ? total : null;
}

// Replace all spoken Hebrew numbers in a string with digit equivalents.
// Handles phrases like "קו שש מאות וחמש עשרה" → "קו 615"
// and "תחנה שש מאות ארבעים ושבע" → "תחנה 647"
function normalizeHebrewNumbers(text) {
    if (!text) return text;
    // Match a sequence of Hebrew number words (up to 6 words) following a keyword
    // We scan every position and try to parse a multi-word number
    let result = text;
    // Build a regex that matches Hebrew number words sequences
    const numWordPattern = /([א-ת]+(?:\s+[א-ת]+){0,5})/g;
    // Replace from right-to-left to preserve indices; simpler: rebuild word by word
    const words = result.split(/(\s+)/);
    const out = [];
    let i = 0;
    while (i < words.length) {
        if (/\s+/.test(words[i])) { out.push(words[i]); i++; continue; }
        // Try to match longest number phrase starting at position i
        let bestLen = 0;
        let bestVal = null;
        // Try up to 6-word combinations
        for (let len = 6; len >= 1; len--) {
            const parts = [];
            let j = i;
            let count = 0;
            while (j < words.length && count < len) {
                if (/\s+/.test(words[j])) { j++; continue; }
                parts.push(words[j]);
                j++;
                count++;
            }
            const phrase = parts.join(" ");
            const val = parseHebrewNumber(phrase);
            if (val !== null && val > 0 && count > bestLen) {
                bestLen = count;
                bestVal = val;
            }
        }
        if (bestLen > 1 && bestVal !== null) {
            // Consume bestLen non-whitespace words
            let count = 0;
            while (i < words.length && count < bestLen) {
                if (/\s+/.test(words[i])) { out.push(words[i]); i++; continue; }
                count++;
                i++;
            }
            out.push(String(bestVal));
        } else {
            out.push(words[i]);
            i++;
        }
    }
    return out.join("");
}

// ============================================================================
// PART 5: ROUTER — classifies Hebrew free-text to a domain + params
// ============================================================================

class MCPRouter {
    static classify(text) {
        if (!text || typeof text !== "string") return null;
        // Normalize spoken Hebrew numbers to digits BEFORE any regex matching
        // so "קו שש מאות וחמש עשרה" becomes "קו 615"
        const t = normalizeHebrewNumbers(text.trim());
        MCPLogger.info("MCPRouter", `classify input (normalized): "${t.substring(0, 120)}"`);

        // --- Flights (טיסות) ---
        if (/(טיסה|טיסות|נתב"ג|נתב"ג|בן גוריון|המראה|נחיתה|חברת תעופה|אל על|ויזאייר|ריינאייר|גאטוויק|יעד הטיסה|רחבת)/.test(t)) {
            const directionMatch = /יוצאות|המראה|יציאה/.test(t) ? "departures" : /נכנסות|נחיתה|הגעה|מגיע/.test(t) ? "arrivals" : "both";
            return { domain: "flights", params: { direction: directionMatch, destination: this._extractCity(t) } };
        }

        // --- Jewish calendar (לוח עברי, שבת, חגים) ---
        if (/(שבת|הדלקת נרות|הבדלה|חג|יום כיפור|פסח|סוכות|שבועות|חנוכה|פורים|ראש השנה|יום טוב|פרשת השבוע|פרשה|חשבון עברי|תאריך עברי|ספירת העומר|ל"ג בעומר|תשפ|תשפ"ה|תש"פ|מוצאי שבת)/.test(t)) {
            return { domain: "jewish_calendar", params: { query: t, location: this._extractCity(t) } };
        }

        // --- Jewish texts (ספריא — Python only, will fail gracefully) ---
        if (/(גמרא|תלמוד|תנ"ך|פסוק|רמב"ם|שולחן ערוך|רש"י|משנה|הלכה|ספריא|מדרש|דף יומי|מסכת|פרק|מקרא)/.test(t)) {
            return { domain: "jewish_texts", params: { query: t } };
        }

        // --- Vehicles (כלי רכב) ---
        if (/(מספר רישוי|מספר לוחית|טסט|תוקף טסט|רכב בעל לוחית|מה הרכב|פרטי הרכב|בעל רכב|דגם הרכב|שנת ייצור|צבע הרכב|מאגר כלי רכב|רישוי הרכב)/.test(t)) {
            const plateMatch = t.match(/\b(\d{2,3}-?\d{2,3}-?\d{2,3})\b/);
            return { domain: "vehicles", params: { plateNumber: plateMatch ? plateMatch[1].replace(/-/g, "") : "" } };
        }

        // --- Nature / wildlife (טבע) ---
        if (/(ציפור|עוף|חרק|זוחל|יונק|צמח|פרח|טבע ישראל|תצפית טבע|מין בעל חיים|צמחייה|אקולוגי|שמורת טבע|iNaturalist|GBIF|מגוון ביולוגי)/.test(t)) {
            return { domain: "nature", params: { area: this._extractCity(t), species: "" } };
        }

        // --- Hiking / trails ---
        if (/(מסלול טיול|שביל|מעיין|נחל|שמורה|פארק לאומי|נקודת עניין|קושי המסלול|הליכה|טיול|ביי"ס שדה|ג'יפ|ג'יפים)/.test(t)) {
            return { domain: "hiking", params: { area: this._extractCity(t) } };
        }

        // --- Transit (train / bus) ---
        // Note: text has already been normalized (spoken numbers → digits) above,
        // so "קו שש מאות וחמש עשרה" is now "קו 615" when this check runs.
        if (/(רכבת קלה|רכבת|אוטובוס|תחנה\s*\d+|קו\s*\d+|קו מספר|זמן יציאה|זמן הגעה|החלפה|איחור|תכנון מסלול|מתי מגיע האוטובוס|שידור חי מהתחנה|מתי יוצאת הרכבת|תחנת אוטובוס|זמן הגעה לתחנה|הסעה|קו\s+\d+|תחנה\s+\d+)/.test(t)) {
            let subtype = "trip";
            if (/רכבת/.test(t) && !/רכבת קלה/.test(t)) subtype = "train";
            else if (/אוטובוס|קו\s*\d+|תחנה\s*\d+/.test(t)) subtype = "bus";
            const lineNum = this._extractLineNumber(t);
            const stationNum = this._extractStationNumber(t);
            return { domain: "transit", params: { subtype, origin: this._extractOrigin(t), destination: this._extractDestination(t), line: lineNum, station: stationNum } };
        }

        // --- Weather (Python-only IMS server — will fail gracefully, Gemini uses own knowledge) ---
        if (/(מזג האוויר|מזג אוויר|טמפרטורה|גשם|שלג|רוח|לחות|חם בחוץ|קר בחוץ|תחזית|ברד|ערפל|חמסין)/.test(t)) {
            return { domain: "weather", params: { city: this._extractCity(t) } };
        }

        return null;
    }

    static _extractCity(text) {
        const knownCities = ["ירושלים", "תל אביב", "חיפה", "באר שבע", "אשדוד", "אשקלון", "נתניה", "פתח תקווה", "רמת גן", "בני ברק", "רחובות", "הרצליה", "כפר סבא", "רעננה", "מודיעין", "ראשון לציון", "ראשל\"צ", "אילת", "נצרת", "טבריה", "צפת", "בית שמש", "בת ים", "חולון", "לוד", "רמלה", "נס ציונה"];
        for (const city of knownCities) {
            if (text.includes(city)) return city;
        }
        const match = text.match(/ב([א-ת]{2,20})(?:\s|$)/);
        return match ? match[1] : null;
    }

    static _extractOrigin(text) {
        const m = text.match(/מ[-\s]?([א-ת]{2,20})/);
        return m ? m[1] : null;
    }

    static _extractDestination(text) {
        const m = text.match(/ל[-\s]?([א-ת]{2,20})(?:\s|$)/);
        return m ? m[1] : null;
    }

    static _extractLineNumber(text) {
        const m = text.match(/קו\s*(\d+)/);
        return m ? m[1] : null;
    }

    static _extractStationNumber(text) {
        const m = text.match(/תחנה\s*(\d+)/);
        return m ? m[1] : null;
    }
}

// ============================================================================
// PART 6: CONTEXT BUILDER
// ============================================================================

class MCPContextBuilder {
    static build(domain, data) {
        if (!data) return null;
        const header = "[מידע חי ומדויק ממקור חיצוני — יש להסתמך אך ורק על הנתונים הבאים ולנסח אותם בעברית טבעית. אין להמציא נתונים נוספים]:";
        const body = MCPResponseFormatter.format(domain, data);
        if (!body) return null;
        return `${header}\n${body}`;
    }

    static buildUnavailable(domain) {
        const domainNames = {
            weather: "מזג האוויר",
            transit: "תחבורה ציבורית",
            hiking: "שבילי טיול",
            flights: "טיסות",
            jewish_calendar: "לוח עברי",
            jewish_texts: "טקסטים יהודיים (ספריא דורש סביבת Python)",
            vehicles: "מאגר כלי רכב",
            nature: "טבע ישראל",
            emergency: "פיקוד העורף",
        };
        const name = domainNames[domain] || domain;
        return `[מידע מערכת חיצוני]: לא ניתן היה לאחזר כרגע מידע עדכני עבור ${name}. יש לציין בפני המש��מש שאין כרגע נתון זמין מהמקור החיצוני, ולא להמציא נתונים. אפשר לענות מידע כללי מהידע שלך.`;
    }
}

// ============================================================================
// PART 7: RESPONSE FORMATTER
// ============================================================================

class MCPResponseFormatter {
    static format(domain, data) {
        try {
            // Extract content from standard MCP result structure
            const raw = data;
            // MCP tools/call result: { content: [{type:"text", text:"..."}], isError: false }
            if (raw && Array.isArray(raw.content)) {
                const textParts = raw.content.filter(c => c.type === "text").map(c => c.text).join("\n");
                if (textParts) return textParts;
            }
            // Fallback: stringify whatever we got
            return `נתוני ${domain}: ${JSON.stringify(raw)}`;
        } catch (e) {
            MCPLogger.error("MCPResponseFormatter", `Failed to format ${domain}`, { error: e.message });
            return null;
        }
    }
}

// ============================================================================
// PART 8: MCPManager — single public entry point used by index.js
// ============================================================================

export class MCPManager {
    /**
     * The ONLY method index.js needs to call.
     * Returns a context string to inject before Gemini, or null if not MCP-routable.
     * Never throws.
     */
    static async buildContextForQuery(transcriptText) {
        try {
            const route = MCPRouter.classify(transcriptText);
            if (!route) return null;

            const { domain, params } = route;
            MCPLogger.info("MCPManager", `Routed to domain: ${domain}`, { params });

            let data = null;
            try {
                data = await this._dispatch(domain, params);
            } catch (e) {
                MCPLogger.warn("MCPManager", `Provider failed for domain ${domain}: ${e.message}`);
                return MCPContextBuilder.buildUnavailable(domain);
            }

            if (!data) return MCPContextBuilder.buildUnavailable(domain);
            return MCPContextBuilder.build(domain, data);

        } catch (e) {
            MCPLogger.error("MCPManager", "Unexpected top-level failure", { error: e.message });
            return null;
        }
    }

    static async _dispatch(domain, params) {
        switch (domain) {
            case "transit":      return TransitProvider.getTransitInfo(params);
            case "hiking":       return HikingProvider.getTrailInfo(params);
            case "flights":      return FlightsProvider.getFlights(params);
            case "jewish_calendar": return JewishCalendarProvider.getInfo(params);
            case "jewish_texts": return JewishTextsProvider.getText(params);
            case "vehicles":     return VehiclesProvider.getVehicle(params);
            case "nature":       return NatureProvider.getObservations(params);
            case "weather":      return WeatherProvider.getWeather(params);
            default:             return null;
        }
    }
}

// Named exports for optional direct use / testing
export {
    MCPRouter,
    MCPContextBuilder,
    MCPResponseFormatter,
    TransitProvider,
    HikingProvider,
    FlightsProvider,
    JewishCalendarProvider,
    VehiclesProvider,
    NatureProvider,
};
