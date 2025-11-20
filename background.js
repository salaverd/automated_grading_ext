// - Receives {action: 'start', autoNext} or {action: 'stop'} from the popup.
// - Validates the active tab URL and injects content.js only into the tab that matches the grading page.
// - Then sends a message { cmd: 'start', autoNext } to the injected content script.
// - On stop, sends { cmd: 'stop' }.

const TARGET_ORIGIN = "https://activities.am.tumo.world"; // <-- CHANGE THIS to your grading site origin
const TARGET_PATH_PREFIX = ""; // optional, change or set to "" to only check origin

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'start') {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            const tab = tabs[0];
            if (!tab || !tab.url) return sendResponse({ ok: false, reason: 'no active tab' });

            try {
                const url = new URL(tab.url);
                if (url.origin !== TARGET_ORIGIN || (TARGET_PATH_PREFIX && !url.pathname.startsWith(TARGET_PATH_PREFIX))) {
                    return sendResponse({ ok: false, reason: 'active tab does not match target grading page' });
                }

                // // Inject the content script file into the active tab
                // await chrome.scripting.executeScript({
                //     target: { tabId: tab.id },
                //     files: ['content.js']
                // });

                // Now tell the content script to start
                chrome.tabs.sendMessage(tab.id, { cmd: 'start', autoNext: !!msg.autoNext });
                sendResponse({ ok: true, injected: true });
            } catch (e) {
                console.error('background start error', e);
                sendResponse({ ok: false, reason: e.message });
            }
        });
        // indicate we'll send the response asynchronously
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
    
    if (msg.cmd === 'fetchPen') {
        fetch(msg.url)
            .then(resp => resp.text())
            .then(html => sendResponse({ html }))
            .catch(err => sendResponse({ error: err.message }));
        return true; // important: keeps the channel open for async response
    }

    sendResponse({ ok: false, reason: 'unknown action' });
    return false;
});
