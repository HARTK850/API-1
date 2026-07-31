/**
 * @file api/TrebloManager.js
 * @description Standalone module for AI song generation via the Treblo (Sonauto) API.
 *
 * Public surface (only what index.js needs to wire in):
 *   - TrebloManager.generateSong(songSpec)     -> { taskId }
 *       songSpec is either a plain string (legacy/simple free-text prompt) or a
 *       { prompt, lyrics, tags } object built by GeminiAIService.buildSongSpec() in
 *       index.js, which turns the caller's raw Hebrew instruction into: an English
 *       style/prompt description (what Treblo's model reliably understands for
 *       genre/mood/instrumentation) plus explicit Hebrew lyrics that actually match
 *       what the caller asked for. Sending the raw Hebrew instruction alone as
 *       `prompt` let Treblo's model drift off-topic and/or write non-Hebrew lyrics,
 *       since a free-text prompt only *hints* at style — it does not pin the lyrics
 *       to a specific language or topic. Explicit `lyrics` pins both.
 *   - TrebloManager.checkSongStatus(taskId)   -> { status, songUrl }
 *   - TrebloManager.waitForCompletion(taskId) -> { status, songUrl }
 *   - TrebloManager.saveSongToYemot(songUrl, yemotToken) -> { fileId, playPrompt }
 *       Saves the finished song into the system's root "extension 800" (a standard
 *       Yemot type=playfile listener extension), auto-creating extension 800 first
 *       if it does not exist yet.
 *
 * Config:
 *   Reads the API key exclusively from process.env.TREBLO_API_KEY.
 *   No key is ever hard-coded here.
 *
 * Notes on scope:
 *   The Treblo API generates original music from a text prompt/tags/lyrics — it does
 *   not clone the voice of a specific named real-world singer. This module simply
 *   forwards the (Gemini-structured) style prompt and Hebrew lyrics to Treblo, the
 *   same way Treblo's own site behaves when you type free text into its generator.
 */

// ============================================================================
// PART 0: CONFIG
// ============================================================================

const TREBLO_CONFIG = {
    BASE_URL: 'https://api.treblo.com/v1',
    GENERATE_ENDPOINT: '/generations/v3',
    STATUS_ENDPOINT: (taskId) => `/generations/status/${taskId}`,
    RESULT_ENDPOINT: (taskId) => `/generations/${taskId}`,
    POLL_INTERVAL_MS: 5000,
    // Vercel's maxDuration for this function is 60s (see vercel.json). Stay safely under it
    // so we always have time left to download+upload the finished song and respond to Yemot.
    MAX_WAIT_MS: 45000,
    REQUEST_TIMEOUT_MS: 15000,
    // Songs are saved into the system's root "extension 800" — a standard Yemot
    // type=playfile listener extension — instead of a plain non-listener folder, so
    // callers can actually dial in and hear generated songs (every generated song must
    // be reachable and playable, not just uploaded to storage).
    YEMOT_SONGS_EXTENSION: '800',
    YEMOT_UPLOAD_DIR: '/800',
};

// ============================================================================
// PART 1: LOGGER (mirrors the style used in voice-engine.js)
// ============================================================================

class TrebloLogger {
    static _fmt(level, msg, extra) {
        const ts = new Date().toISOString();
        const base = `[${ts}] [TrebloManager:${level}] ${msg}`;
        return extra !== undefined ? `${base} :: ${JSON.stringify(extra)}` : base;
    }
    static info(msg, extra) { console.log(this._fmt('INFO', msg, extra)); }
    static warn(msg, extra) { console.warn(this._fmt('WARN', msg, extra)); }
    static error(msg, extra) { console.error(this._fmt('ERROR', msg, extra)); }
}

// ============================================================================
// PART 2: TIMEOUT HELPER
// ============================================================================

async function withTimeout(promise, ms, label) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
    });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        clearTimeout(timeoutId);
    }
}

// ============================================================================
// PART 3: ERROR TYPE
// ============================================================================

export class TrebloAPIError extends Error {
    constructor(message, isStillGenerating = false) {
        super(message);
        this.name = 'TrebloAPIError';
        this.isStillGenerating = isStillGenerating;
    }
}

// ============================================================================
// PART 4: LOW-LEVEL API CLIENT
// ============================================================================

class TrebloAPIClient {
    static getApiKey() {
        const key = process.env.TREBLO_API_KEY;
        if (!key) throw new TrebloAPIError('חסר מפתח TREBLO_API_KEY במשתני הסביבה.');
        return key;
    }

    static async _request(path, options = {}) {
        const apiKey = this.getApiKey();
        const url = `${TREBLO_CONFIG.BASE_URL}${path}`;
        const response = await withTimeout(
            fetch(url, {
                ...options,
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    ...(options.headers || {}),
                },
            }),
            TREBLO_CONFIG.REQUEST_TIMEOUT_MS,
            `TrebloAPI(${path})`
        );

        if (!response.ok) {
            let errBody = '';
            try { errBody = await response.text(); } catch (e) {}
            throw new TrebloAPIError(`Treblo API HTTP ${response.status}: ${errBody}`.trim());
        }
        return response.json();
    }

    /**
     * Accepts either a plain string (legacy free-text prompt only) or a structured
     * { prompt, lyrics, tags } spec. When lyrics are provided, they are sent as-is
     * (already in Hebrew, already on-topic — see GeminiAIService.buildSongSpec in
     * index.js) so Treblo sings exactly what was asked for, in Hebrew, instead of
     * inferring its own (often off-topic, often non-Hebrew) lyrics from a vague
     * free-text prompt alone.
     */
    static async createGeneration(songSpec) {
        const spec = (typeof songSpec === 'string') ? { prompt: songSpec } : (songSpec || {});
        const body = {};

        const prompt = String(spec.prompt || '').trim();
        if (prompt) body.prompt = prompt;

        const lyrics = String(spec.lyrics || '').trim();
        if (lyrics) body.lyrics = lyrics;

        // Defense-in-depth: Treblo's tags field is validated server-side against a
        // fixed vocabulary (unrecognized tags cause a full HTTP 422 rejection of the
        // whole request, e.g. "chassidic"/"jewish-music"). GeminiAIService.buildSongSpec
        // in index.js already sanitizes tags before they get here, but if this method
        // is ever called directly with a raw tags array, don't forward anything that
        // looks obviously unsafe (empty/duplicate) as-is.
        if (Array.isArray(spec.tags) && spec.tags.length) {
            const seen = new Set();
            const cleaned = [];
            for (const t of spec.tags) {
                const norm = String(t || '').trim().toLowerCase();
                if (norm && !seen.has(norm)) { seen.add(norm); cleaned.push(norm); }
            }
            if (cleaned.length) body.tags = cleaned;
        }

        if (!body.prompt && !body.lyrics && !(body.tags && body.tags.length)) {
            throw new TrebloAPIError('לא התקבלה הנחיה ליצירת השיר.');
        }

        const data = await this._request(TREBLO_CONFIG.GENERATE_ENDPOINT, {
            method: 'POST',
            body: JSON.stringify(body),
        });
        if (!data || !data.task_id) throw new TrebloAPIError('Treblo לא החזיר task_id.');
        return data.task_id;
    }

    static async getStatus(taskId) {
        const data = await this._request(TREBLO_CONFIG.STATUS_ENDPOINT(taskId), { method: 'GET' });
        // Plain-string status ("SUCCESS"/"GENERATING"/etc) per Treblo docs.
        return typeof data === 'string' ? data : (data && data.status) || 'UNKNOWN';
    }

    static async getResult(taskId) {
        return this._request(TREBLO_CONFIG.RESULT_ENDPOINT(taskId), { method: 'GET' });
    }
}

// ============================================================================
// PART 5: YEMOT SONG UPLOADER — saves the finished song into Yemot's own file
// storage (this project has no persistent filesystem / DB blob store; audio
// always lives in Yemot's ivr2: storage, played back via f-<fileId>).
//
// Generated songs are saved into the root "extension 800" (/800), a standard
// Yemot "play files" listener extension (type=playfile). This ensures a song is
// not just sitting in file storage — it is actually reachable and playable by
// any caller who dials extension 800 from the main system menu. If extension
// 800 does not exist yet, it is created automatically the first time a song is
// saved (via the Yemot Management API's UploadTextFile, which both creates the
// folder and writes its ext.ini in one call, matching the platform's documented
// "type=playfile" recipe for a plain file-playback extension).
// ============================================================================

class YemotSongUploader {
    /**
     * Ensures the root "extension 800" (a standard type=playfile listener
     * extension) exists, creating it automatically if it doesn't. Idempotent and
     * safe to call before every song upload — if the extension (and its ext.ini)
     * already exist, this simply overwrites ext.ini with the same content.
     */
    static async ensureSongsExtensionExists(yemotToken) {
        const extIniPath = `ivr2:${TREBLO_CONFIG.YEMOT_UPLOAD_DIR}/ext.ini`;
        // Minimal, standard "play files" extension configuration: plays the files
        // uploaded into this folder to any caller who reaches extension 800.
        const extIniContents = [
            'type=playfile',
            'title=שירים שנוצרו על ידי המערכת',
        ].join('\r\n');

        const params = new URLSearchParams({
            token: yemotToken,
            path: extIniPath,
            contents: extIniContents,
        });

        const res = await withTimeout(
            fetch(`https://www.call2all.co.il/ym/api/UploadTextFile?${params.toString()}`),
            TREBLO_CONFIG.REQUEST_TIMEOUT_MS,
            'YemotUploadTextFile(ext.ini for /800)'
        );
        if (!res.ok) {
            TrebloLogger.warn('Failed to ensure /800 extension exists (HTTP error) — continuing, upload may still succeed if it already exists', { status: res.status });
            return;
        }
        const data = await res.json().catch(() => ({}));
        if (data.responseStatus && data.responseStatus !== 'OK') {
            TrebloLogger.warn('Failed to ensure /800 extension exists (API error) — continuing, upload may still succeed if it already exists', { message: data.message || data.responseStatus });
            return;
        }
        TrebloLogger.info('Ensured /800 song-playback extension exists', { extIniPath });
    }

    /**
     * Downloads the finished song from Treblo's CDN and re-uploads it into
     * Yemot's storage (extension 800) with a digits-only filename, exactly like
     * the rest of the project's f-<fileId> playback convention (see voice-engine.js).
     */
    static async saveToYemot(songUrl, yemotToken) {
        if (!yemotToken) throw new TrebloAPIError('חסר טוקן ימות המשיח (CALL2ALL_TOKEN) לשמירת השיר.');

        // Make sure the listener-facing playback extension exists before uploading
        // into it, so the song is guaranteed to be reachable by phone right away.
        await this.ensureSongsExtensionExists(yemotToken);

        const songResp = await withTimeout(fetch(songUrl), TREBLO_CONFIG.REQUEST_TIMEOUT_MS, 'DownloadTrebloSong');
        if (!songResp.ok) throw new TrebloAPIError(`הורדת השיר מ-Treblo נכשלה: HTTP ${songResp.status}`);
        const songBuffer = Buffer.from(await songResp.arrayBuffer());

        // Digits-only filename, matching the project's existing numeric-filename convention.
        const fileName = `${Date.now()}`;
        const targetPath = `${TREBLO_CONFIG.YEMOT_UPLOAD_DIR}/${fileName}`;
        const uploadPath = `ivr2:${targetPath}`;

        // Yemot's UploadFile expects token/path/qqfile as multipart fields and reports
        // success through `responseStatus`. Playback then references the file by path.
        const form = new FormData();
        form.append('token', yemotToken);
        form.append('path', uploadPath);
        form.append('convertAudio', '1');
        form.append('qqfile', new Blob([songBuffer], { type: 'audio/mpeg' }), `${fileName}.mp3`);

        const uploadResp = await withTimeout(
            fetch('https://www.call2all.co.il/ym/api/UploadFile', { method: 'POST', body: form }),
            TREBLO_CONFIG.REQUEST_TIMEOUT_MS,
            'YemotUploadFile(TrebloSong)'
        );
        if (!uploadResp.ok) throw new TrebloAPIError(`העלאת השיר לימות המשיח נכשלה: HTTP ${uploadResp.status}`);

        const data = await uploadResp.json().catch(() => ({}));
        if (data.responseStatus && data.responseStatus !== 'OK') {
            throw new TrebloAPIError(`העלאת השיר לימות המשיח נדחתה: ${data.message || data.responseStatus}`);
        }
        const fileId = targetPath;

        return {
            fileId,
            fileName,
            extension: TREBLO_CONFIG.YEMOT_SONGS_EXTENSION,
            savedPath: `${TREBLO_CONFIG.YEMOT_UPLOAD_DIR}/${fileName}`,
        };
    }
}

// ============================================================================
// PART 6: PUBLIC ENTRY POINT
// ============================================================================

export class TrebloManager {
    /**
     * True only for the specific "still generating, ran out of time this turn"
     * timeout thrown by waitForCompletion — not for genuine Treblo/network failures.
     */
    static isStillGeneratingError(e) {
        return !!(e && e.isStillGenerating);
    }

    /**
     * Starts a new song generation. Accepts either a plain prompt string (legacy) or
     * a structured { prompt, lyrics, tags } spec (see GeminiAIService.buildSongSpec
     * in index.js) built from the caller's transcribed recording. Returns the Treblo
     * task_id to poll later.
     */
    static async generateSong(songSpec) {
        const spec = (typeof songSpec === 'string') ? { prompt: songSpec } : (songSpec || {});
        const hasContent = (spec.prompt && String(spec.prompt).trim()) ||
                            (spec.lyrics && String(spec.lyrics).trim()) ||
                            (Array.isArray(spec.tags) && spec.tags.length);
        if (!hasContent) {
            throw new TrebloAPIError('לא התקבלה הנחיה ליצירת השיר.');
        }
        TrebloLogger.info('Submitting generation request', {
            promptPreview: String(spec.prompt || '').substring(0, 80),
            hasLyrics: !!(spec.lyrics && String(spec.lyrics).trim()),
            tags: spec.tags || [],
        });
        try {
            const taskId = await TrebloAPIClient.createGeneration(spec);
            TrebloLogger.info('Generation started', { taskId });
            return { taskId };
        } catch (e) {
            // Treblo validates "tags" against a fixed vocabulary and rejects the
            // ENTIRE request (HTTP 422) if even one tag isn't recognized. GeminiAIService
            // already maps/filters tags to a known-good whitelist before they ever get
            // here, but as a last line of defense: if we still hit a 422 that mentions
            // tags specifically, retry once with tags dropped entirely rather than
            // failing the whole song generation over a style hint.
            const msg = String(e && e.message || '');
            const isTagsValidationError = /HTTP 422/.test(msg) && /tags/i.test(msg);
            if (isTagsValidationError && spec.tags && spec.tags.length) {
                TrebloLogger.warn('Tags rejected by Treblo, retrying without tags', { error: msg });
                const specWithoutTags = { ...spec, tags: [] };
                const taskId = await TrebloAPIClient.createGeneration(specWithoutTags);
                TrebloLogger.info('Generation started (retry without tags)', { taskId });
                return { taskId };
            }
            throw e;
        }
    }

    /**
     * Checks the current status of a generation task. If it has succeeded,
     * also fetches the resulting song URL.
     */
    static async checkSongStatus(taskId) {
        const status = await TrebloAPIClient.getStatus(taskId);
        if (status === 'SUCCESS') {
            const result = await TrebloAPIClient.getResult(taskId);
            const songUrl = (result && Array.isArray(result.song_paths)) ? result.song_paths[0] : null;
            if (!songUrl) throw new TrebloAPIError('הסטטוס הצליח אך לא נמצא קישור לשיר.');
            return { status, songUrl };
        }
        if (status === 'FAILURE') {
            throw new TrebloAPIError('יצירת השיר נכשלה בשרתי Treblo.');
        }
        return { status, songUrl: null };
    }

    /**
     * Polls checkSongStatus until the song is ready, times out, or fails.
     * Stays within TREBLO_CONFIG.MAX_WAIT_MS to respect the Vercel function's
     * maxDuration — if the song isn't ready in time, throws so the caller can
     * tell the user to check back, rather than hanging the HTTP request.
     */
    static async waitForCompletion(taskId) {
        const start = Date.now();
        while (Date.now() - start < TREBLO_CONFIG.MAX_WAIT_MS) {
            const { status, songUrl } = await this.checkSongStatus(taskId);
            TrebloLogger.info('Polling status', { taskId, status, elapsedMs: Date.now() - start });
            if (status === 'SUCCESS' && songUrl) return { status, songUrl };
            await new Promise(resolve => setTimeout(resolve, TREBLO_CONFIG.POLL_INTERVAL_MS));
        }
        throw new TrebloAPIError('יצירת השיר עדיין בתהליך ולא הסתיימה בזמן הצפוי. אנא נסו שוב מאוחר יותר.', true);
    }

    /**
     * Downloads the finished song and stores it in Yemot's own storage with a
     * digits-only filename, returning an f-<fileId> style prompt segment ready
     * to hand to YemotResponseCompiler.playChainedTTS / requestDigits chains.
     */
    static async saveSongToYemot(songUrl, yemotToken) {
        const saved = await YemotSongUploader.saveToYemot(songUrl, yemotToken);
        TrebloLogger.info('Song saved to Yemot storage', saved);
        return { ...saved, playPrompt: `f-${saved.fileId}` };
    }
}
