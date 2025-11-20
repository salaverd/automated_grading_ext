// Injected into the grading page when you press Start. It:
// - finds the current student's CodePen links (3 links),
// - fetches each CodePen page html,
// - extracts JS,
// - checks syntax with new Function(code) (no execution!),
// - clicks Award if all OK, otherwise clicks Reject,
// - if autoNext is enabled, clicks Next and repeats until no Next or Stop requested.

const STUDENT_CONTAINER_SELECTOR = "div.examiner-task-text-answer-content";
const EXAMINER_COMPONENT_SELECTOR = "div.examiner-component-feedback";
const CODEPEN_LINK_SELECTOR = "a[href*='codepen.io']";
const AWARD_BUTTON_SELECTOR = "button.examiner-component-feedback-status-button-award.feedback-status-buttons-focus.v-btn.v-btn--outlined.theme--dark.v-size--default.examiner-tab-stop";
const REJECT_BUTTON_SELECTOR = "button.examiner-component-feedback-status-button-reject";
// const REJECT_BUTTON_SELECTOR = "button.examiner-component-feedback-status-button-reject.feedback-status-buttons-focus.v-btn.v-btn--outlined.theme--dark.v-size--default.examiner-tab-stop";
const NEXT_BUTTON_SELECTOR = "button.examiner-next-and-save-button.v-btn v-btn--text.theme--light.v-size--large";

function bySelectorOrText(selectorStr, root = document) {
    const parts = selectorStr.split(',').map(p => p.trim());
    for (const part of parts) {
        if (part.includes(':contains(')) {
            const m = part.match(/:contains\(['"]?(.*?)['"]?\)/);
            if (!m) continue;
            const txt = m[1].toLowerCase();
            // search among clickable elements  
            const els = Array.from(root.querySelectorAll('button, a, input, span, div'));
            const found = els.find(e => (e.innerText || '').toLowerCase().includes(txt));
            if (found) return found;
        } else {
            const el = root.querySelector(part);
            if (el) return el;
        }
    }
    return null;
}

async function fetchPenHTML(url) {
    // try {
    //     const resp = await fetch(url, { credentials: 'omit' });
    //     if (!resp.ok) {
    //         console.warn('fetchPenHTML non-ok', resp.status, url);
    //         return null;
    //     }
    //     return await resp.text();
    // } catch (e) {
    //     console.warn('fetchPenHTML error', e, url);
    //     return null;
    // }
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ cmd: 'fetchPen', url }, (resp) => {
            if (resp.error) {
                console.warn('fetchPenHTML error', resp.error, url);
                resolve(null);
            } else {
                resolve(resp.html);
            }
        });
    });
}

function extractJSFromPenHTML(html) {
    if (!html) return '';
    // pattern used by CodePen for rendered JS
    let m = html.match(/<script[^>]*id=["']rendered-js["'][^>]*>([\s\S]*?)<\/script>/i);
    if (m) return m[1];

    const scripts = Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)).map(x => x[1]).filter(Boolean);
    if (scripts.length) {
        scripts.sort((a, b) => b.length - a.length);
        return scripts[0];
    }
    return '';
}

function checkSyntax(code) {
    try {
        new Function(code || '');
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message || String(e) };
    }
}

let stopRequested = false;
let isProcessing = false;

async function processCurrentStudent(autoNext) {
    if (isProcessing) {
        console.log('Already processing - ignoring duplicate start');
        return;
    }
    isProcessing = true;
    stopRequested = false;

    while (!stopRequested) {
        try {
            const studentRoot = document.querySelector(STUDENT_CONTAINER_SELECTOR) || document;
            const examinationRoot = document.querySelector(EXAMINER_COMPONENT_SELECTOR) || document;

            // gather codepen anchors inside studentRoot
            const anchors = Array.from(studentRoot.querySelectorAll(CODEPEN_LINK_SELECTOR));
            if (!anchors.length) {
                console.warn('No CodePen links found in student container. Check STUDENT_CONTAINER_SELECTOR and CODEPEN_LINK_SELECTOR.');
                break;
            }

            // choose up to 3 relevant pens
            const pens = anchors.slice(0, 3).map(a => a.href);
            console.log('Grader found CodePen links:', pens);

            let anyFail = false;
            const details = [];

            for (const penUrl of pens) {
                if (stopRequested) break;
                console.log('Fetching pen:', penUrl);
                const html = await fetchPenHTML(penUrl);
                if (!html) {
                    anyFail = true;
                    details.push({ pen: penUrl, reason: 'Failed to fetch pen HTML' });
                    break;
                }
                const js = extractJSFromPenHTML(html);
                // const corsProxy = 'https://cors-anywhere.herokuapp.com/';
                // const jsUrl = corsProxy + penUrl.replace('/pen/', '/pen/') + '.js';
                // const js = await fetch(jsUrl).then(r => r.text());

                // const fetch = require('node-fetch');

                // const jsUrl = penUrl + '.js';
                // const res = await fetch(jsUrl);
                // const js = await res.text();

                console.log("FOUND JS: ");
                console.log(js);

                const result = checkSyntax(js);
                if (!result.ok) {
                    anyFail = true;
                    details.push({ pen: penUrl, reason: result.error });
                    break;
                } else {
                    details.push({ pen: penUrl, reason: 'OK' });
                }
            }

            if (anyFail) {
                const rejectEl = bySelectorOrText(REJECT_BUTTON_SELECTOR, examinationRoot);
                console.log('Marking REJECT for this student. Details:', details);
                if (rejectEl) {
                    rejectEl.click();
                } else {
                    console.warn('Reject button not found; check REJECT_BUTTON_SELECTOR');
                }
            } else {
                const awardEl = bySelectorOrText(AWARD_BUTTON_SELECTOR, examinationRoot);
                console.log('Marking AWARD for this student. Details:', details);
                if (awardEl) {
                    awardEl.click();
                } else {
                    console.warn('Award button not found; check AWARD_BUTTON_SELECTOR');
                }
            }

            if (!autoNext) {
                console.log('Auto Next disabled — stopping after current student.');
                break;
            }

            // find and click Next button, wait a bit for the page to update
            const nextEl = bySelectorOrText(NEXT_BUTTON_SELECTOR);
            if (nextEl) {
                console.log('Clicking Next to go to next student.');
                nextEl.click();

                await new Promise(r => setTimeout(r, 1700));

                continue;
            } else {
                console.log('No Next button found — stopping.');
                break;
            }
        } catch (e) {
            console.error('Error inside processCurrentStudent loop:', e);
            break;
        }
    }

    isProcessing = false;
    console.log('Grader stopped.');
}

// listen for messages from background.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.cmd === 'start') {
        const autoNext = !!msg.autoNext;
        console.log('Grader received start, autoNext=', autoNext);
        processCurrentStudent(autoNext);
        sendResponse({ started: true });
    } else if (msg.cmd === 'stop') {
        console.log('Grader received stop');
        stopRequested = true;
        sendResponse({ stopped: true });
    }
});