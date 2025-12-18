const TARGET_ORIGIN = "https://activities.am.tumo.world";
const TARGET_PATH_PREFIX = "";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {

        if (msg.action === 'start') {
            chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
                const tab = tabs[0];
                if (!tab || !tab.url) return sendResponse({ ok: false, reason: 'no active tab' });

                try {
                    const url = new URL(tab.url);
                    if (url.origin !== TARGET_ORIGIN || (TARGET_PATH_PREFIX && !url.pathname.startsWith(TARGET_PATH_PREFIX))) {
                        return sendResponse({ ok: false, reason: 'active tab does not match target grading page' });
                    }

                    // await chrome.scripting.executeScript({
                    //     target: { tabId: tab.id },
                    //     files: ['content.js']
                    // });

                    chrome.tabs.sendMessage(tab.id, { cmd: 'start', autoNext: !!msg.autoNext });
                    sendResponse({ ok: true, injected: true });
                } catch (e) {
                    console.error('background start error', e);
                    sendResponse({ ok: false, reason: e.message });
                }
            });
            return true;
        }

        if (msg.action === 'stop') {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (!tab) return sendResponse({ ok: false, reason: 'no active tab' });
                chrome.tabs.sendMessage(tab.id, { cmd: 'stop' });
                sendResponse({ ok: true });
            });
            return true;
        }

        if (msg.cmd === 'fetchPen' && msg.url) {
            try {
                const resp = await fetch(msg.url, { credentials: 'omit' }); // or 'include' if you want cookies
                console.log("fetchPen respone from background ", resp);
                
                if (!resp.ok) {
                    sendResponse({ ok: false, error: `HTTP ${resp.status}` });
                    return;
                }
                const html = await resp.text();
                sendResponse({ ok: true, html });
                return;
            } catch (fetchErr) {
                sendResponse({ ok: false, error: String(fetchErr) });
                return;
            }
        }

        sendResponse({ ok: false, reason: 'unknown action' });
    })();

    return true;
});
