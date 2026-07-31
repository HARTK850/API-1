/**
 * @file api/web-admin.js
 * @description Standalone web UI for API key self-service and secured system administration.
 * @description Standalone web UI for self-service Gemini API key management.
 */

export function generateApiKeysHtml() {
    return `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ניהול מפתחות API - מערכת חכמה</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f3f4f6; }
        .gradient-bg { background: linear-gradient(135deg, #4F46E5 0%, #2563EB 100%); }
    </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4">
    <div id="donateOverlay" class="fixed inset-0 bg-black/50 z-50 hidden items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
            <div class="gradient-bg px-6 py-6 text-center text-white shrink-0">
                <i class="fas fa-hand-holding-heart text-3xl mb-2"></i>
                <h2 class="text-xl font-bold">בקשה קטנה מצוות המערכת</h2>
            </div>
            <div class="p-6 space-y-4 text-gray-700 text-sm leading-relaxed overflow-y-auto">
                <p>שלום וברכה! עקב עומסים גדולים על מערכת ה-API המשותפת, נשמח מאוד אם תוכלו לתרום מפתח Gemini API אחד או יותר לטובת כלל מאזיני המערכת.</p>
                <p>המפתח שתתרמו יצטרף למאגר הכללי ויעזור לכל המאזינים ליהנות משירות מהיר ויציב יותר. התרומה היא כמובן לחלוטין וולונטרית, ואפשר תמיד להוסיף מפתחות אישיים נוספים רק לעצמכם דרך הטופס הרגיל.</p>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">מפתח/ות לתרומה (רשות)</label>
                    <textarea id="donateKeysInput" rows="3" class="block w-full p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-gray-50 text-gray-900" placeholder="AIzaSy...&#10;AIzaSy..."></textarea>
                    <p class="text-xs text-gray-500 mt-1">הגבלת טוקונים למפתחות התרומה ניתן להגדיר אחרי התרומה, מהחלון "ניהול מפתחות שתרמתי".</p>
                </div>
                <div id="donateStatus" class="hidden rounded-lg p-3 text-sm font-medium text-center"></div>
            </div>
            <div class="px-6 pb-6 pt-2 grid grid-cols-1 gap-2 shrink-0 border-t">
                <button id="donateSubmitBtn" type="button" class="w-full py-3 px-4 rounded-lg text-sm font-medium text-white gradient-bg hover:opacity-90"><i class="fas fa-heart ml-2"></i>תרומה למאגר הכללי</button>
                <div class="grid grid-cols-2 gap-2">
                    <button id="donateLaterBtn" type="button" class="w-full py-2.5 px-4 rounded-lg text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200">הזכר לי מאוחר יותר</button>
                    <button id="donateNoBtn" type="button" class="w-full py-2.5 px-4 rounded-lg text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200">לא רוצה, תודה</button>
                </div>
            </div>
        </div>
    </div>
    <div id="limitOverlay" class="fixed inset-0 bg-black/50 z-50 hidden items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div class="gradient-bg px-6 py-5 text-center text-white">
                <i class="fas fa-gauge-high text-2xl mb-2"></i>
                <h2 class="text-lg font-bold">הגבלת כמות טוקנים</h2>
            </div>
            <div class="p-6 space-y-4 text-gray-700 text-sm">
                <p class="text-xs text-gray-500">בחרו הגבלה מוגדרת מראש, או הזינו כמות מותאמת אישית. ניתן גם לבטל את ההגבלה לגמרי.</p>
                <div id="limitPresetOptions" class="grid grid-cols-2 gap-2"></div>
                <div>
                    <label class="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
                        <input type="radio" name="limitChoice" id="limitCustomRadio" value="custom">
                        כמות מותאמת אישית
                    </label>
                    <input type="number" id="limitCustomInput" min="1" disabled class="block w-full p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-gray-50 text-gray-900 disabled:opacity-50" placeholder="הזינו כמות טוקנים">
                </div>
                <div id="limitStatus" class="hidden rounded-lg p-3 text-sm font-medium text-center"></div>
            </div>
            <div class="px-6 pb-6 grid grid-cols-2 gap-2">
                <button id="limitSaveBtn" type="button" class="w-full py-2.5 px-4 rounded-lg text-sm font-medium text-white gradient-bg hover:opacity-90"><i class="fas fa-check ml-1"></i>שמירה</button>
                <button id="limitCancelBtn" type="button" class="w-full py-2.5 px-4 rounded-lg text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200">ביטול</button>
            </div>
        </div>
    </div>
    <div class="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div class="gradient-bg px-6 py-8 text-center text-white">
            <i class="fas fa-robot text-4xl mb-4"></i>
            <h1 class="text-2xl font-bold">הגדרת מפתחות אישיים</h1>
            <p class="text-indigo-100 mt-2 text-sm">המפתחות ישויכו למספר הטלפון שלך במערכת</p>
        </div>
        <div class="p-6 md:p-8 space-y-6">
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">מספר טלפון במערכת</label>
                <div class="relative">
                    <div class="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none"><i class="fas fa-phone text-gray-400"></i></div>
                    <input type="tel" id="phone" required class="block w-full pr-10 pl-3 py-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-gray-50 text-gray-900" placeholder="0501234567">
                </div>
            </div>

            <div>
                <div class="flex items-center justify-between mb-1">
                    <label class="block text-sm font-medium text-gray-700">מפתחות שמורים כרגע</label>
                    <button type="button" id="refreshBtn" class="text-xs text-indigo-600 hover:underline"><i class="fas fa-rotate ml-1"></i>רענון</button>
                </div>
                <ul id="currentKeysList" class="space-y-2 mb-1"></ul>
                <p id="noKeysMsg" class="text-xs text-gray-400 hidden">לא נמצאו מפתחות שמורים למספר זה (במערכת או בגיבוי המקומי).</p>
            </div>

            <form id="keyForm" class="space-y-3">
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">הוספת מפתח/ות Gemini API חדשים</label>
                    <textarea id="apiKeys" rows="4" class="block w-full p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-gray-50 text-gray-900" placeholder="AIzaSy...&#10;AIzaSy..."></textarea>
                    <p class="text-xs text-gray-500 mt-1">אפשר להכניס כמה מפתחות חדשים שרוצים, כל מפתח בשורה נפרדת או מופרד בפסיק. המפתחות מתווספים לרשימה הקיימת ולא מוחקים אותה. הגבלת טוקונים אפשר להגדיר לכל מפתח בנפרד, מהרשימה שלמעלה, אחרי ההוספה.</p>
                </div>
                <div id="statusMessage" class="hidden rounded-lg p-4 text-sm font-medium text-center"></div>
                <button type="submit" class="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white gradient-bg hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-opacity">
                    <i class="fas fa-plus ml-2 mt-1"></i> הוסף מפתחות
                </button>
            </form>

            <div class="border-t pt-5">
                <button type="button" id="toggleDonatedPanelBtn" class="w-full flex items-center justify-between py-2 px-3 rounded-lg text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100">
                    <span><i class="fas fa-hand-holding-heart ml-2"></i>ניהול מפתחות שתרמתי למאגר הכללי</span>
                    <i class="fas fa-chevron-up"></i>
                </button>
            </div>
        </div>
    </div>
    <div id="donatedOverlay" class="fixed inset-0 bg-black/50 z-50 hidden items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto">
            <div class="gradient-bg px-6 py-5 text-center text-white sticky top-0">
                <button type="button" id="donatedPanelCloseBtn" class="absolute left-4 top-4 text-white/80 hover:text-white"><i class="fas fa-times"></i></button>
                <i class="fas fa-hand-holding-heart text-2xl mb-2"></i>
                <h2 class="text-lg font-bold">ניהול מפתחות שתרמתי למאגר הכללי</h2>
            </div>
            <div id="donatedPanel" class="p-6 space-y-3">
                <p class="text-xs text-gray-500">כאן ניתן לראות רק את המפתחות שאתם תרמתם למאגר הכללי (משויכים למספר הטלפון שלכם), למחוק תרומה שהתחרטתם עליה, לעדכן הגבלת טוקונים, או לתרום מפתח נוסף.</p>
                <div class="flex items-center justify-between">
                    <span class="text-xs font-medium text-gray-700">מפתחות שנתרמו</span>
                    <button type="button" id="refreshDonatedBtn" class="text-xs text-indigo-600 hover:underline"><i class="fas fa-rotate ml-1"></i>רענון</button>
                </div>
                <ul id="donatedKeysList" class="space-y-2"></ul>
                <p id="noDonatedMsg" class="text-xs text-gray-400 hidden">לא נמצאו מפתחות תרומה עבור מספר הטלפון הזה.</p>
                <div class="border-t pt-3 space-y-2">
                    <label class="block text-sm font-medium text-gray-700">תרומת מפתח/ות נוספים</label>
                    <textarea id="panelDonateKeysInput" rows="2" class="block w-full p-3 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-gray-50 text-gray-900" placeholder="AIzaSy...&#10;AIzaSy..."></textarea>
                    <button type="button" id="panelDonateSubmitBtn" class="w-full py-2.5 px-4 rounded-lg text-sm font-medium text-white gradient-bg hover:opacity-90"><i class="fas fa-heart ml-2"></i>תרומה למאגר הכללי</button>
                    <div id="panelDonateStatus" class="hidden rounded-lg p-3 text-sm font-medium text-center"></div>
                </div>
            </div>
        </div>
    </div>
    <script>
        const phoneInput = document.getElementById('phone');
        const currentKeysList = document.getElementById('currentKeysList');
        const noKeysMsg = document.getElementById('noKeysMsg');
        const statusDiv = document.getElementById('statusMessage');

        function localStorageKey(phone) { return 'personalApiKeys_' + phone; }
        function localLimitsStorageKey(phone) { return 'personalApiKeyLimits_' + phone; }

        function getLocalKeys(phone) {
            try { return JSON.parse(localStorage.getItem(localStorageKey(phone)) || '[]'); }
            catch (e) { return []; }
        }

        function setLocalKeys(phone, keys) {
            try { localStorage.setItem(localStorageKey(phone), JSON.stringify(keys)); } catch (e) {}
        }

        function getLocalLimits(phone) {
            try { return JSON.parse(localStorage.getItem(localLimitsStorageKey(phone)) || '[]'); }
            catch (e) { return []; }
        }

        function setLocalLimits(phone, limits) {
            try { localStorage.setItem(localLimitsStorageKey(phone), JSON.stringify(limits || [])); } catch (e) {}
        }

        function showStatus(message, ok) {
            statusDiv.classList.remove('hidden');
            statusDiv.className = 'rounded-lg p-4 text-sm font-medium text-center ' + (ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800');
            statusDiv.innerHTML = '<i class="fas ' + (ok ? 'fa-check-circle' : 'fa-exclamation-triangle') + ' ml-1"></i> ' + message;
        }

        // --- Styled token-limit modal (replaces the old prompt() popup) ----------------
        const LIMIT_PRESETS = [1000, 4000, 8000, 16000];
        const limitOverlay = document.getElementById('limitOverlay');
        const limitPresetOptions = document.getElementById('limitPresetOptions');
        const limitCustomRadio = document.getElementById('limitCustomRadio');
        const limitCustomInput = document.getElementById('limitCustomInput');
        const limitStatus = document.getElementById('limitStatus');
        const limitSaveBtn = document.getElementById('limitSaveBtn');
        const limitCancelBtn = document.getElementById('limitCancelBtn');
        let limitModalResolver = null;

        limitPresetOptions.innerHTML = ['<label class="flex items-center gap-2 text-sm"><input type="radio" name="limitChoice" value="none" id="limitNoneRadio"><span>ללא הגבלה</span></label>']
            .concat(LIMIT_PRESETS.map(v => '<label class="flex items-center gap-2 text-sm"><input type="radio" name="limitChoice" value="' + v + '"><span>' + v.toLocaleString('he-IL') + ' טוקונים</span></label>'))
            .join('');

        limitPresetOptions.addEventListener('change', () => { limitCustomInput.disabled = true; });
        limitCustomRadio.addEventListener('change', () => { limitCustomInput.disabled = false; limitCustomInput.focus(); });

        function showLimitStatus(message, ok) {
            limitStatus.classList.remove('hidden');
            limitStatus.className = 'rounded-lg p-3 text-sm font-medium text-center ' + (ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800');
            limitStatus.textContent = message;
        }

        // Opens the styled limit modal and resolves with a token-limit number (0 = no limit),
        // or null if the user cancelled. currentLimit pre-selects the matching preset/custom option.
        function openLimitModal(currentLimit) {
            limitStatus.classList.add('hidden');
            const presetMatch = LIMIT_PRESETS.includes(currentLimit);
            document.getElementById('limitNoneRadio').checked = !currentLimit;
            limitCustomInput.disabled = true;
            limitCustomInput.value = '';
            if (currentLimit && presetMatch) {
                const el = limitPresetOptions.querySelector('input[value="' + currentLimit + '"]');
                if (el) el.checked = true;
            } else if (currentLimit) {
                limitCustomRadio.checked = true;
                limitCustomInput.disabled = false;
                limitCustomInput.value = currentLimit;
            }
            limitOverlay.classList.remove('hidden');
            limitOverlay.classList.add('flex');
            return new Promise(resolve => { limitModalResolver = resolve; });
        }

        function closeLimitModal(result) {
            limitOverlay.classList.add('hidden');
            limitOverlay.classList.remove('flex');
            if (limitModalResolver) { limitModalResolver(result); limitModalResolver = null; }
        }

        limitCancelBtn.addEventListener('click', () => closeLimitModal(null));

        limitSaveBtn.addEventListener('click', () => {
            const choice = document.querySelector('input[name="limitChoice"]:checked');
            if (!choice) { showLimitStatus('יש לבחור אפשרות.', false); return; }
            if (choice.value === 'none') { closeLimitModal(0); return; }
            if (choice.value === 'custom') {
                const val = Number(limitCustomInput.value);
                if (!limitCustomInput.value.trim() || !Number.isFinite(val) || val <= 0) {
                    showLimitStatus('יש להזין כמות טוקונים חיובית.', false);
                    return;
                }
                closeLimitModal(Math.floor(val));
                return;
            }
            closeLimitModal(Number(choice.value));
        });

        function renderKeys(phone, keys, limits) {
            limits = limits || [];
            currentKeysList.innerHTML = '';
            noKeysMsg.classList.toggle('hidden', keys.length > 0);
            keys.forEach(key => {
                const li = document.createElement('li');
                li.className = 'flex items-center justify-between gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono text-gray-700';
                const masked = key.length > 10 ? key.slice(0, 6) + '••••••••' + key.slice(-4) : key;
                const limitEntry = limits.find(l => l && l.key === key);
                const limitLabel = limitEntry && limitEntry.tokenLimit ? ('מוגבל ל-' + limitEntry.tokenLimit + ' טוקונים') : 'ללא הגבלה';
                li.innerHTML = '<span class="truncate">' + masked + '</span><span class="text-[10px] text-gray-400 shrink-0">' + limitLabel + '</span>';
                const limitBtn = document.createElement('button');
                limitBtn.type = 'button';
                limitBtn.className = 'text-indigo-500 hover:text-indigo-700 shrink-0';
                limitBtn.title = 'עדכון הגבלת טוקונים';
                limitBtn.innerHTML = '<i class="fas fa-gauge-high"></i>';
                limitBtn.onclick = () => updateKeyLimit(phone, key, limitEntry ? limitEntry.tokenLimit : null);
                li.appendChild(limitBtn);
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'text-red-500 hover:text-red-700 shrink-0';
                delBtn.innerHTML = '<i class="fas fa-trash"></i>';
                delBtn.onclick = () => deleteKey(phone, key);
                li.appendChild(delBtn);
                currentKeysList.appendChild(li);
            });
        }

        async function fetchServerKeys(phone) {
            const url = new URL(window.location.href);
            url.searchParams.delete('web');
            url.searchParams.set('web_action', 'get_keys');
            const response = await fetch(url.toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ phone })
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || 'שגיאה בטעינת מפתחות');
            return { apiKeys: result.apiKeys || [], apiKeyLimits: result.apiKeyLimits || [] };
        }

        async function loadKeys() {
            const phone = phoneInput.value.trim();
            if (!phone) { renderKeys('', [], []); return; }
            const localKeys = getLocalKeys(phone);
            const localLimits = getLocalLimits(phone);
            renderKeys(phone, localKeys, localLimits); // show local backup immediately while server loads
            try {
                const { apiKeys: serverKeys, apiKeyLimits: serverLimits } = await fetchServerKeys(phone);
                const merged = [...new Set([...serverKeys, ...localKeys])];
                setLocalKeys(phone, merged);
                setLocalLimits(phone, serverLimits);
                renderKeys(phone, merged, serverLimits);
            } catch (e) {
                // Server unreachable/failed — local backup (already rendered) still shows.
            }
        }

        async function deleteKey(phone, apiKey) {
            if (!confirm('להסיר את המפתח הזה?')) return;
            try {
                const url = new URL(window.location.href);
                url.searchParams.delete('web');
                url.searchParams.set('web_action', 'delete_key');
                const response = await fetch(url.toString(), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({ phone, apiKey })
                });
                const result = await response.json();
                if (!response.ok || !result.success) throw new Error(result.error || 'שגיאה במחיקה');
                setLocalKeys(phone, result.apiKeys || []);
                renderKeys(phone, result.apiKeys || [], getLocalLimits(phone));
                showStatus('המפתח הוסר בהצלחה.', true);
            } catch (e) {
                showStatus(e.message, false);
            }
        }

        async function updateKeyLimit(phone, apiKey, currentLimit) {
            const tokenLimit = await openLimitModal(currentLimit || 0);
            if (tokenLimit === null) return; // cancelled
            try {
                const url = new URL(window.location.href);
                url.searchParams.delete('web');
                url.searchParams.set('web_action', 'update_key_limit');
                const response = await fetch(url.toString(), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({ phone, apiKey, tokenLimit })
                });
                const result = await response.json();
                if (!response.ok || !result.success) throw new Error(result.error || 'שגיאה בעדכון ההגבלה');
                setLocalLimits(phone, result.apiKeyLimits || []);
                renderKeys(phone, getLocalKeys(phone), result.apiKeyLimits || []);
                showStatus('הגבלת הטוקונים עודכנה בהצלחה.', true);
            } catch (e) {
                showStatus(e.message, false);
            }
        }

        phoneInput.addEventListener('change', loadKeys);
        phoneInput.addEventListener('blur', loadKeys);
        document.getElementById('refreshBtn').addEventListener('click', loadKeys);

        // --- Donation consent popup ---------------------------------------------------
        // Shown once on entry. If the user donates a key, or explicitly chooses "לא רוצה",
        // it is remembered in localStorage and never shown again. If the user chooses
        // "הזכר לי מאוחר יותר", nothing is stored, so it will keep appearing on future visits
        // until the user either donates or explicitly declines.
        const DONATE_DECISION_KEY = 'apiKeyDonation_decision'; // 'donated' | 'declined'
        const donateOverlay = document.getElementById('donateOverlay');
        const donateStatus = document.getElementById('donateStatus');

        function showDonateStatus(message, ok) {
            donateStatus.classList.remove('hidden');
            donateStatus.className = 'rounded-lg p-3 text-sm font-medium text-center ' + (ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800');
            donateStatus.textContent = message;
        }

        function closeDonateOverlay() {
            donateOverlay.classList.add('hidden');
            donateOverlay.classList.remove('flex');
        }

        function maybeShowDonatePopup() {
            let decision = null;
            try { decision = localStorage.getItem(DONATE_DECISION_KEY); } catch (e) {}
            if (decision === 'donated' || decision === 'declined') return; // never show again
            donateOverlay.classList.remove('hidden');
            donateOverlay.classList.add('flex');
        }

        document.getElementById('donateLaterBtn').addEventListener('click', () => {
            // Deliberately does NOT write to localStorage, so the popup reappears next visit.
            closeDonateOverlay();
        });

        document.getElementById('donateNoBtn').addEventListener('click', () => {
            try { localStorage.setItem(DONATE_DECISION_KEY, 'declined'); } catch (e) {}
            closeDonateOverlay();
        });

        document.getElementById('donateSubmitBtn').addEventListener('click', async () => {
            const btn = document.getElementById('donateSubmitBtn');
            const keysText = document.getElementById('donateKeysInput').value.trim();
            if (!keysText) { showDonateStatus('ניתן להדביק מפתח/ות, או לבחור באחת מהאפשרויות למטה.', false); return; }
            const phone = phoneInput.value.trim();
            if (!phone) { showDonateStatus('יש להזין קודם מספר טלפון בטופס הראשי, כדי שנוכל לשייך אליכם את התרומה.', false); return; }
            btn.disabled = true;
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin ml-2"></i> שולח תרומה...';
            try {
                const url = new URL(window.location.href);
                url.searchParams.delete('web');
                url.searchParams.set('web_action', 'donate_key');
                const response = await fetch(url.toString(), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({ apiKeys: keysText, phone })
                });
                const result = await response.json();
                if (response.ok && result.success) {
                    try { localStorage.setItem(DONATE_DECISION_KEY, 'donated'); } catch (e) {}
                    showDonateStatus('תודה רבה! המפתח נוסף למאגר הכללי לתועלת כלל המאזינים.', true);
                    setTimeout(closeDonateOverlay, 1800);
                } else {
                    throw new Error(result.error || 'שגיאה בשליחת התרומה');
                }
            } catch (err) {
                showDonateStatus(err.message, false);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        });

        maybeShowDonatePopup();

        document.getElementById('keyForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button');
            const phone = phoneInput.value.trim();
            const payload = {
                phone,
                apiKeys: document.getElementById('apiKeys').value
            };
            if (!phone) { showStatus('יש להזין מספר טלפון', false); return; }
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin ml-2 mt-1"></i> מעדכן...';
            statusDiv.className = 'hidden rounded-lg p-4 text-sm font-medium text-center';
            try {
                const url = new URL(window.location.href);
                url.searchParams.delete('web');
                url.searchParams.set('web_action', 'update_keys');
                const response = await fetch(url.toString(), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const contentType = response.headers.get('content-type') || '';
                if (!contentType.includes('application/json')) throw new Error('השרת החזיר תשובת HTML במקום JSON. נסו לרענן את הדף.');
                const result = await response.json();
                if (response.ok && result.success) {
                    setLocalKeys(phone, result.apiKeys || []);
                    setLocalLimits(phone, result.apiKeyLimits || []);
                    renderKeys(phone, result.apiKeys || [], result.apiKeyLimits || []);
                    showStatus('נשמרו ' + result.keyCount + ' מפתחות סה"כ למספר שהוזן. אפשר להגדיר הגבלת טוקונים לכל מפתח מהרשימה שלמעלה.', true);
                    document.getElementById('apiKeys').value = '';
                } else {
                    throw new Error(result.error || 'שגיאה כללית');
                }
            } catch (err) {
                showStatus(err.message, false);
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-plus ml-2 mt-1"></i> הוסף מפתחות';
            }
        });

        // --- Dedicated "manage donated keys" panel (modal) ------------------------------
        // Issue: a dedicated interface, opened above the page via a button, to view only
        // the donor's OWN donated keys (scoped by phone — see list_donated_keys backend),
        // delete them, limit them, or add more, separate from the one-time consent popup.
        const donatedOverlay = document.getElementById('donatedOverlay');
        const donatedKeysList = document.getElementById('donatedKeysList');
        const noDonatedMsg = document.getElementById('noDonatedMsg');
        const panelDonateStatus = document.getElementById('panelDonateStatus');

        function showPanelDonateStatus(message, ok) {
            panelDonateStatus.classList.remove('hidden');
            panelDonateStatus.className = 'rounded-lg p-3 text-sm font-medium text-center ' + (ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800');
            panelDonateStatus.textContent = message;
        }

        function openDonatedPanel() {
            const phone = phoneInput.value.trim();
            if (!phone) { showStatus('יש להזין מספר טלפון בטופס הראשי לפני צפייה במפתחות התרומה שלכם.', false); return; }
            donatedOverlay.classList.remove('hidden');
            donatedOverlay.classList.add('flex');
            loadDonatedKeys();
        }

        function closeDonatedPanel() {
            donatedOverlay.classList.add('hidden');
            donatedOverlay.classList.remove('flex');
        }

        document.getElementById('toggleDonatedPanelBtn').addEventListener('click', openDonatedPanel);
        document.getElementById('donatedPanelCloseBtn').addEventListener('click', closeDonatedPanel);

        async function loadDonatedKeys() {
            const phone = phoneInput.value.trim();
            if (!phone) return;
            donatedKeysList.innerHTML = '<li class="text-xs text-gray-400"><i class="fas fa-spinner fa-spin ml-1"></i>טוען...</li>';
            try {
                const url = new URL(window.location.href);
                url.searchParams.delete('web');
                url.searchParams.set('web_action', 'list_donated_keys');
                const response = await fetch(url.toString(), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({ phone })
                });
                const result = await response.json();
                if (!response.ok || !result.success) throw new Error(result.error || 'שגיאה בטעינת מפתחות התרומה');
                renderDonatedKeys(result.donatedKeys || []);
            } catch (e) {
                donatedKeysList.innerHTML = '';
                showPanelDonateStatus(e.message, false);
            }
        }

        function renderDonatedKeys(entries) {
            donatedKeysList.innerHTML = '';
            noDonatedMsg.classList.toggle('hidden', entries.length > 0);
            entries.forEach(entry => {
                const li = document.createElement('li');
                li.className = 'flex items-center justify-between gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono text-gray-700';
                const limitLabel = entry.tokenLimit ? ('מוגבל ל-' + entry.tokenLimit + ' טוקונים') : 'ללא הגבלה';
                li.innerHTML = '<span class="truncate">' + entry.maskedKey + '</span><span class="text-[10px] text-gray-400 shrink-0">' + limitLabel + '</span>';
                const limitBtn = document.createElement('button');
                limitBtn.type = 'button';
                limitBtn.className = 'text-indigo-500 hover:text-indigo-700 shrink-0';
                limitBtn.title = 'עדכון הגבלת טוקונים';
                limitBtn.innerHTML = '<i class="fas fa-gauge-high"></i>';
                limitBtn.onclick = () => updateDonatedKeyLimit(entry.fullKey, entry.tokenLimit);
                li.appendChild(limitBtn);
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'text-red-500 hover:text-red-700 shrink-0';
                delBtn.title = 'מחיקת התרומה';
                delBtn.innerHTML = '<i class="fas fa-trash"></i>';
                delBtn.onclick = () => deleteDonatedKey(entry.fullKey);
                li.appendChild(delBtn);
                donatedKeysList.appendChild(li);
            });
        }

        async function deleteDonatedKey(apiKey) {
            if (!confirm('להסיר את התרומה הזו לצמיתות מהמאגר הכללי?')) return;
            const phone = phoneInput.value.trim();
            try {
                const url = new URL(window.location.href);
                url.searchParams.delete('web');
                url.searchParams.set('web_action', 'delete_donated_key');
                const response = await fetch(url.toString(), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({ apiKey, phone })
                });
                const result = await response.json();
                if (!response.ok || !result.success) throw new Error(result.error || 'שגיאה במחיקת התרומה');
                showPanelDonateStatus('התרומה הוסרה בהצלחה מהמאגר הכללי.', true);
                loadDonatedKeys();
            } catch (e) {
                showPanelDonateStatus(e.message, false);
            }
        }

        async function updateDonatedKeyLimit(apiKey, currentLimit) {
            const tokenLimit = await openLimitModal(currentLimit || 0);
            if (tokenLimit === null) return;
            const phone = phoneInput.value.trim();
            try {
                const url = new URL(window.location.href);
                url.searchParams.delete('web');
                url.searchParams.set('web_action', 'update_donated_key_limit');
                const response = await fetch(url.toString(), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({ apiKey, tokenLimit, phone })
                });
                const result = await response.json();
                if (!response.ok || !result.success) throw new Error(result.error || 'שגיאה בעדכון ההגבלה');
                showPanelDonateStatus('הגבלת הטוקונים עודכנה בהצלחה.', true);
                loadDonatedKeys();
            } catch (e) {
                showPanelDonateStatus(e.message, false);
            }
        }

        document.getElementById('refreshDonatedBtn').addEventListener('click', loadDonatedKeys);

        document.getElementById('panelDonateSubmitBtn').addEventListener('click', async () => {
            const btn = document.getElementById('panelDonateSubmitBtn');
            const keysText = document.getElementById('panelDonateKeysInput').value.trim();
            if (!keysText) { showPanelDonateStatus('ניתן להדביק מפתח/ות לתרומה.', false); return; }
            const phone = phoneInput.value.trim();
            if (!phone) { showPanelDonateStatus('יש להזין מספר טלפון בטופס הראשי.', false); return; }
            btn.disabled = true;
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin ml-2"></i> שולח תרומה...';
            try {
                const url = new URL(window.location.href);
                url.searchParams.delete('web');
                url.searchParams.set('web_action', 'donate_key');
                const response = await fetch(url.toString(), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({ apiKeys: keysText, phone })
                });
                const result = await response.json();
                if (response.ok && result.success) {
                    try { localStorage.setItem(DONATE_DECISION_KEY, 'donated'); } catch (e) {}
                    showPanelDonateStatus('תודה רבה! המפתח נוסף למאגר הכללי. ניתן להגדיר לו הגבלת טוקונים מהרשימה שלמעלה.', true);
                    document.getElementById('panelDonateKeysInput').value = '';
                    loadDonatedKeys();
                } else {
                    throw new Error(result.error || 'שגיאה בשליחת התרומה');
                }
            } catch (err) {
                showPanelDonateStatus(err.message, false);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        });
    </script>
</body>
</html>`;
}


export function generateSystemAdminHtml(isAuthenticated = false) {
    return `
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ניהול מערכת - עויזר צ'אט</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-100 min-h-screen p-4">
<div class="max-w-6xl mx-auto bg-white rounded-2xl shadow p-6">
<h1 class="text-3xl font-bold mb-2">ניהול מערכת עויזר צ'אט</h1>
<p class="text-slate-600 mb-6">כניסה מאובטחת בקישור אימות חד פעמי התקף לחמש דקות.</p>
${!isAuthenticated ? `
<div class="border rounded-xl p-6 bg-blue-50 max-w-sm">
  <p class="mb-3 font-medium">כניסה לניהול מערכת:</p>
  <div class="flex gap-2">
    <input type="password" id="pwdInput" placeholder="סיסמת ניהול" class="border rounded-lg px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500">
    <button id="pwdBtn" class="bg-blue-700 text-white px-4 py-2 rounded-lg text-sm">כניסה</button>
  </div>
  <div id="msg" class="mt-3 text-sm font-medium"></div>
</div>` : `
<div class="grid md:grid-cols-4 gap-4 mb-6" id="stats"></div>
<div class="overflow-x-auto"><table class="w-full text-sm border"><thead class="bg-slate-200"><tr><th class="p-2">טלפון</th><th>שיחות</th><th>מייל</th><th>מפתח אישי</th><th>פעולות</th></tr></thead><tbody id="users"></tbody></table></div>
`}
</div>
<script>
async function api(action, body={}) { const r = await fetch(window.location.pathname+'?web_action='+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); return r.json(); }
${!isAuthenticated ? `
const msg = document.getElementById('msg');
function showMsg(text, ok) { msg.className = 'mt-3 text-sm font-medium ' + (ok ? 'text-green-700' : 'text-red-700'); msg.textContent = text; }
document.getElementById('pwdBtn').onclick = async () => {
  const pwd = document.getElementById('pwdInput').value;
  if (!pwd) { showMsg('אנא הכניסו סיסמה', false); return; }
  showMsg('מתחבר...', true);
  try {
    const r = await api('admin_password_login', { password: pwd });
    if (r.success) { showMsg('✓ כניסה הצליחה, מרענן...', true); setTimeout(() => location.href = (r.redirect || '/api?web=system_admin'), 300); }
    else showMsg(r.error || 'סיסמה שגויה', false);
  } catch(e) { showMsg('שגיאת תקשורת', false); }
};
document.getElementById('pwdInput').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('pwdBtn').click(); });
` : `
async function load(){ const d=await api('admin_data');
 document.getElementById('stats').innerHTML = [['שיחות',d.stats.totalSessions],['הצלחות',d.stats.totalSuccess],['שגיאות',d.stats.totalErrors],['משתמשים',d.users.length]].map(x=>'<div class="bg-slate-100 p-4 rounded-xl"><b>'+x[0]+'</b><div class="text-2xl">'+(x[1]||0)+'</div></div>').join('');
 document.getElementById('users').innerHTML = d.users.map(u=>'<tr class="border-t"><td class="p-2">'+u.phone+'</td><td>'+(u.chatCount||0)+'</td><td>'+(u.emailAddress||'')+'</td><td>'+(u.personalKeyCount||0)+'</td><td><button class="text-red-700" onclick="block(\\''+u.phone+'\\',true)">חסום</button> | <button class="text-green-700" onclick="block(\\''+u.phone+'\\',false)">שחרר</button> | <button onclick="showChats(\\''+u.phone+'\\')">שיחות</button></td></tr><tr id="chats_'+u.phone+'" class="hidden"><td colspan="5" class="bg-slate-50 p-3">'+u.chats.map(c=>'<details><summary>'+ (c.topic||'שיחה') +' ('+(c.messages?.length||0)+')</summary><pre class="whitespace-pre-wrap">'+(c.messages||[]).map(m=>'שאלה: '+m.q+'\\nתשובה: '+m.a).join('\\n\\n')+'</pre></details>').join('')+'</td></tr>').join(''); }
async function block(phone, blocked){ await api('admin_block',{phone,blocked}); load(); }
function showChats(phone){ document.getElementById('chats_'+phone).classList.toggle('hidden'); }
load();
`}
</script></body></html>`;
}
