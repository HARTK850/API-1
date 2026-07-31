/**
 * @file api/voice-engine.js
 * @description Modular alternate-voice (TTS) layer for "עויזר צ'אט".
 *
 * Lets each user choose, in the settings menu, between:
 *   - The system's default Yemot robotic voice (unchanged, zero cost, always available)
 *   - "אברי" (he-IL-AvriNeural) — free Microsoft neural male Hebrew voice
 *   - "הילה" (he-IL-HilaNeural) — free Microsoft neural female Hebrew voice
 *
 * Both alternate voices come from the `edge-tts-universal` npm package, which talks
 * to Microsoft Edge's public TTS WebSocket service directly using only Web APIs
 * (WebSocket, fetch, Web Crypto). No API key, no cost, no rate limit tied to us,
 * and it works natively in Vercel's Edge Runtime (confirmed by the library's own
 * docs: "works identically in Node.js, Deno, Bun, and edge runtimes").
 *
 * HOW PLAYBACK SWITCHING WORKS (Yemot mechanics):
 *   Yemot's `id_list_message`/`read` prompt strings support two relevant prefixes:
 *     - "t-<text>"   -> played by Yemot's own built-in robotic TTS voice
 *     - "f-<fileId>" -> plays a pre-uploaded audio file by its Yemot file ID
 *   So to make an alternate engine "become the voice that reads the whole system",
 *   we synthesize each `t-` segment with edge-tts-universal, upload the resulting
 *   audio to the user's Yemot system via the standard Yemot UploadFile API, and
 *   swap the prompt segment from `t-<text>` to `f-<fileId>` before the response is
 *   compiled. `m-####` (system numeric/fixed messages) and `d-####` (digit readouts)
 *   are intentionally left untouched — those are Yemot system sounds without a
 *   public text source to resynthesize from, and remain in the default voice.
 *
 * INTEGRATION SURFACE (only two things index.js needs):
 *   1) VoiceEngine.getVoiceMenuAddition() -> Hebrew menu text for settings option 4.
 *   2) VoiceEngine.applyVoiceToChain(chainArray, voiceId) -> returns a new array
 *      with `t-` entries replaced by `f-<fileId>` entries in the chosen voice
 *      (or the original array unchanged if voiceId is "default" or unset).
 *   Persisting the user's chosen voiceId on their profile is a single new field
 *   (`ttsVoice`) — index.js just needs to read/write it like any other profile field.
 */

import { EdgeTTS } from 'edge-tts-universal';

// ============================================================================
// PART 0: VOICE CATALOG
// ============================================================================

export const VOICE_CATALOG = {
    default: { id: 'default', label: 'הקול הרגיל של המערכת', edgeVoice: null },
    avri: { id: 'avri', label: 'אברי', edgeVoice: 'he-IL-AvriNeural', gender: 'זכר' },
    hila: { id: 'hila', label: 'הילה', edgeVoice: 'he-IL-HilaNeural', gender: 'נקבה' },
};

const VOICE_ENGINE_CONFIG = {
    TIMEOUT_MS: 6000,
    UPLOAD_DIR: '/ApiVoiceCache', // Yemot-side folder where synthesized clips are stored
};

// ============================================================================
// PART 1: LOGGER
// ============================================================================

class VoiceEngineLogger {
    static _fmt(level, msg, extra) {
        const ts = new Date().toISOString();
        const base = `[${ts}] [VoiceEngine:${level}] ${msg}`;
        return extra !== undefined ? `${base} :: ${JSON.stringify(extra)}` : base;
    }
    static info(msg, extra) { console.log(this._fmt('INFO', msg, extra)); }
    static warn(msg, extra) { console.warn(this._fmt('WARN', msg, extra)); }
    static error(msg, extra) { console.error(this._fmt('ERROR', msg, extra)); }
}

// ============================================================================
// PART 2: IN-MEMORY CACHE (text+voice -> Yemot file id)
// Warm-isolate reuse only; safe no-op cost if the isolate is cold.
// ============================================================================

class VoiceFileCache {
    static _store = new Map();
    static _key(voiceId, text) { return `${voiceId}::${text}`; }
    static get(voiceId, text) { return this._store.get(this._key(voiceId, text)) || null; }
    static set(voiceId, text, fileId) { this._store.set(this._key(voiceId, text), fileId); }
}

// ============================================================================
// PART 3: TIMEOUT HELPER
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
// PART 4: SYNTHESIZER — wraps edge-tts-universal
// ============================================================================

class NeuralSynthesizer {
    /**
     * Synthesizes `text` with the given Edge neural voice, returns a Buffer (mp3).
     */
    static async synthesize(text, edgeVoiceName) {
        // edge-tts-universal requires an explicit sign on these SSML-style prosody
        // values ('+0%'/'+0Hz'); a bare '0%' (no sign) is rejected with
        // "Invalid rate '0%'." and the segment silently falls back to the default
        // voice instead of using the requested one.
        const tts = new EdgeTTS(text, edgeVoiceName, {
            rate: '+0%',
            volume: '+0%',
            pitch: '+0Hz',
        });
        const result = await withTimeout(tts.synthesize(), VOICE_ENGINE_CONFIG.TIMEOUT_MS, `EdgeTTS(${edgeVoiceName})`);
        const arrayBuffer = await result.audio.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }
}

// ============================================================================
// PART 5: YEMOT UPLOADER — pushes synthesized audio into the Yemot system
// so it becomes playable via the standard f-<fileId> prompt prefix.
// ============================================================================

class YemotAudioUploader {
    /**
     * Uploads an audio buffer to Yemot's file storage using the same
     * call2all.co.il API family the rest of the system already uses for
     * downloads (see YemotAPIService.downloadAudioAsBase64 in index.js).
     * Returns the numeric/textual file ID Yemot assigns, suitable for
     * an "f-<id>" prompt segment.
     */
    static async upload(audioBuffer, callId, yemotToken) {
        if (!yemotToken) throw new Error('Missing Yemot token for voice upload');

        // Yemot's UploadFile expects a multipart form with the fields `token`, `path`
        // and `qqfile` (the binary), and reports success via `responseStatus: "OK"`.
        // The previous version sent a `file` field and read a non-existent `fileId`
        // from the response, so it produced broken f- references that played nothing.
        const fileName = `voice_${callId}_${Date.now()}`;
        const targetPath = `${VOICE_ENGINE_CONFIG.UPLOAD_DIR}/${fileName}`;
        const uploadPath = `ivr2:${targetPath}`;

        const form = new FormData();
        form.append('token', yemotToken);
        form.append('path', uploadPath);
        form.append('convertAudio', '1');
        form.append('qqfile', new Blob([audioBuffer], { type: 'audio/mpeg' }), `${fileName}.mp3`);

        const resp = await withTimeout(
            fetch('https://www.call2all.co.il/ym/api/UploadFile', { method: 'POST', body: form }),
            VOICE_ENGINE_CONFIG.TIMEOUT_MS,
            'YemotUploadFile'
        );
        if (!resp.ok) throw new Error(`Yemot upload failed: HTTP ${resp.status}`);

        const data = await resp.json().catch(() => ({}));
        if (data.responseStatus && data.responseStatus !== 'OK') {
            throw new Error(`Yemot upload rejected: ${data.message || data.responseStatus}`);
        }

        // Files are referenced for playback by their path inside the system,
        // i.e. an "f-/ApiVoiceCache/<name>" prompt segment.
        return targetPath;
    }
}

// ============================================================================
// PART 6: PUBLIC ENTRY POINT
// ============================================================================

export class VoiceEngine {
    static getVoiceMenuAddition() {
        return `להגדרת קול הקראה, הקישו 4.`;
    }

    static getVoiceChoicePrompt() {
        return `בחירת קול הקראה. להשארת הקול הרגיל של המערכת הקישו 1. לבחירת הקול הנקרא אברי הקישו 2. לבחירת הקול הנקרא הילה הקישו 3. לחזרה לתפריט ההגדרות הקישו 0.`;
    }

    static resolveVoiceChoice(digit) {
        if (digit === '1') return VOICE_CATALOG.default.id;
        if (digit === '2') return VOICE_CATALOG.avri.id;
        if (digit === '3') return VOICE_CATALOG.hila.id;
        return null; // invalid / 0 = no change
    }

    static getVoiceConfirmationText(voiceId) {
        const voice = Object.values(VOICE_CATALOG).find(v => v.id === voiceId) || VOICE_CATALOG.default;
        return `t-הקול שנבחר הוא ${voice.label}. השינוי ייכנס לתוקף כעת.`;
    }

    /**
     * Given a chain of Yemot prompt segments (as produced by
     * YemotResponseCompiler) and a chosen voiceId, returns a NEW array where
     * every "t-<text>" segment has been replaced with "f-<fileId>" pointing to
     * that text synthesized in the chosen neural voice. "m-" and "d-" and
     * already-"f-" segments pass through unchanged. Never throws: on any
     * synthesis/upload failure for a given segment, that segment silently
     * falls back to its original "t-" (default Yemot voice) form so the call
     * never breaks.
     */
    static async applyVoiceToChain(chainSegments, voiceId, callId, yemotToken) {
        if (!voiceId || voiceId === VOICE_CATALOG.default.id) return chainSegments;
        const voice = Object.values(VOICE_CATALOG).find(v => v.id === voiceId);
        if (!voice || !voice.edgeVoice) return chainSegments;

        const results = [];
        for (const segment of chainSegments) {
            if (typeof segment !== 'string' || !segment.startsWith('t-')) {
                results.push(segment);
                continue;
            }
            const text = segment.substring(2);
            if (!text.trim()) { results.push(segment); continue; }

            try {
                const fileId = await this._synthesizeAndCache(text, voice, callId, yemotToken);
                results.push(`f-${fileId}`);
            } catch (e) {
                VoiceEngineLogger.warn('Segment synthesis failed, falling back to default voice for this segment', { error: e.message });
                results.push(segment); // graceful fallback: keep original t- segment
            }
        }
        return results;
    }

    static async _synthesizeAndCache(text, voice, callId, yemotToken) {
        const cached = VoiceFileCache.get(voice.id, text);
        if (cached) return cached;

        const start = Date.now();
        const audioBuffer = await NeuralSynthesizer.synthesize(text, voice.edgeVoice);
        const fileId = await YemotAudioUploader.upload(audioBuffer, callId, yemotToken);
        VoiceFileCache.set(voice.id, text, fileId);

        VoiceEngineLogger.info(`Synthesized+uploaded segment in ${Date.now() - start}ms`, { voice: voice.id, chars: text.length });
        return fileId;
    }
}
