// Injected into the grading page when you press Start. It:
// - finds the current student's CodePen links (3 links),
// - fetches each CodePen page html,
// - extracts JS,
// - checks syntax with new Function(code) (no execution!),
// - clicks Award if all OK, otherwise clicks Reject,
// - if autoNext is enabled, clicks Next and repeats until no Next or Stop requested.

// const STUDENT_CONTAINER_SELECTOR = "div.examiner-task-text-answer-content";
const STUDENT_CONTAINER_SELECTOR = "div.examiner-activity-container-components-wrapper";
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

    let m = html.match(/<script[^>]*id=["']rendered-js["'][^>]*>([\s\S]*?)<\/script>/i);
    if (m) return m[1];

    const scripts = Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)).map(x => x[1]).filter(Boolean);
    if (scripts.length) {
        scripts.sort((a, b) => b.length - a.length);
        return scripts[0];
    }
    return '';
}

function parseCodePenUrl(url) {
    try {
        const u = new URL(url);
        if (!/codepen\.io$/i.test(u.hostname) && !/codepen\.io/i.test(u.hostname)) {
            return null;
        }
        // split pathname into non-empty pieces
        const parts = u.pathname.split('/').filter(Boolean); // e.g. ["Narek-Hovsepyan-the-encoder","pen","OPNjPrw"]
        if (parts.length === 0) return null;

        // username is usually first segment
        const username = parts[0];

        // find "pen" (or "pens") in path then take next segment as slug
        let slug = null;
        const penIdx = parts.findIndex(p => p === 'pen' || p === 'pens');
        if (penIdx !== -1 && parts.length > penIdx + 1) slug = parts[penIdx + 1];

        // some URLs use /username/slug directly (rare) or embed paths, handle fallback
        if (!slug && parts.length >= 2) {
            // if second part looks like a slug (alphanumeric/hyphen/underscore), treat it as slug
            slug = parts[1];
        }

        if (!username || !slug) return null;
        // strip query/hash from slug if present (shouldn't be, but safe)
        slug = slug.split('?')[0].split('#')[0];

        return { username, slug };
    } catch (e) {
        return null;
    }
}

async function fetchPenViaCPV2(username, slug) {
    const url = `https://cpv2api.herokuapp.com/${encodeURIComponent(username)}/pen/${encodeURIComponent(slug)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('fetch failed ' + r.status);
    const data = await r.json();
    return {
        html: data.html ?? '',
        css: data.css ?? '',
        js: data.js ?? ''
    };
}

async function fetchPenFromUrl(penUrl) {
    const parsed = parseCodePenUrl(penUrl);
    console.log("Parsed data: ", parsed.username, parsed.slug);

    if (!parsed) throw new Error('Could not parse CodePen URL: ' + penUrl);
    return await fetchPenViaCPV2(parsed.username, parsed.slug);
}

async function fetchPenJS(user, slug) {
    const apiUrl = `https://cpv2api.herokuapp.com/pens/${user}/${slug}`;
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error("Failed to fetch pen: " + res.status);
    const data = await res.json();

    if (!data.success) throw new Error("API returned failure");

    if (!data.pen || !data.pen.js) throw new Error("No JS file found in pen");

    return data.pen.js;
}

function checkSyntax(code) {
    try {
        new Function(code || '');
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message || String(e) };
    }
}

function bgSend(msg) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(msg, (resp) => {
            if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
            resolve(resp);
        });
    });
}

function extractJsFromHtml(html) {
    console.log('test1');

    // Parse to DOM
    const doc = new DOMParser().parseFromString(html, 'text/html');
    console.log('test2');

    // 1) Try CodeMirror lines (lines are often under `.CodeMirror-line` or `.cm-line`)
    const lineSelectors = ['.CodeMirror-line', '.cm-line', '.CodeMirror-code pre'];
    console.log('lineSelectors: ', lineSelectors);
    for (const sel of lineSelectors) {
        console.log('test3');
        const nodes = Array.from(doc.querySelectorAll(sel));
        
        if (nodes.length) {
            // join lines preserving order
            const code = nodes.map(n => n.textContent || '').join('\n');
            console.log("Fetched code from extractJsFromHtml", code);
            console.log('test4');
            if (code.trim().length) return code;
        }
    }
}


function extractJsFromHtml1(html) {
    // parse HTML to DOM
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // helper to clean line text
    const clean = (s) => (s || '').replace(/\u00A0/g, ' ').replace(/\r/g, '').replace(/\t/g, '    ');

    // 1) Prefer the CodeMirror container
    let container = doc.querySelector('.CodeMirror-code');
    if (!container) {
        // sometimes there are extra classes or the element is a div with similar name,
        // try a looser match (any element that contains CodeMirror-code in its class list)
        container = Array.from(doc.querySelectorAll('[class]')).find(el =>
            String(el.className).split(/\s+/).includes('CodeMirror-code')
        ) || null;
    }

    // function to collect line elements under a container
    const collectLinesFrom = (root) => {
        if (!root) return [];
        // select elements whose class list contains CodeMirror-line (handles " CodeMirror-line " etc.)
        const lineEls = Array.from(root.querySelectorAll('[class~="CodeMirror-line"]'));
        if (lineEls.length) return lineEls.map(el => clean(el.textContent));
        // fallback: some CodeMirror builccds use <pre> children or other wrappers; try direct children that look like lines
        const maybeLines = Array.from(root.children).map(c => clean(c.textContent || '')).filter(t => t.length);
        if (maybeLines.length) return maybeLines;
        return [];
    };

    // Try extracting lines from container first
    let lines = collectLinesFrom(container);
    // If not found, try searching the whole document for CodeMirror-line
    if (!lines.length) {
        lines = collectLinesFrom(doc);
    }

    // If still empty, try a looser query: any element with 'CodeMirror' and then gather textContent of its descendant lines
    if (!lines.length) {
        const cmEls = Array.from(doc.querySelectorAll('[class*="CodeMirror"]'));
        for (const el of cmEls) {
            const l = collectLinesFrom(el);
            if (l.length) {
                lines = l;
                break;
            }
        }
    }

    // Final fallback: try to find long <pre> or <textarea> blocks that look like JS
    if (!lines.length) {
        const candidates = Array.from(doc.querySelectorAll('pre, textarea, code'));
        for (const el of candidates) {
            const t = clean(el.textContent || '');
            if (t.length > 20 && (t.includes('function') || t.includes('let ') || t.includes('const ') || t.includes('=>'))) {
                lines = t.split(/\r?\n/).map(l => l.trimRight());
                break;
            }
        }
    }

    if (!lines.length) return null;

    // Join lines preserving newlines and remove trailing empty lines
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    const code = lines.join('\n');

    return code;
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
            const results = [];

            // for (const penUrl of pens) {
            //     if (stopRequested) break;
            //     console.log('Fetching pen:', penUrl);
            // const html = await fetchPenHTML(penUrl);
            // if (!html) {
            //     anyFail = true;
            //     details.push({ pen: penUrl, reason: 'Failed to fetch pen HTML' });
            //     break;
            // }
            // const js = extractJSFromPenHTML(html);
            penUrl = 'https://codepen.io/pen?template=OPNOENz.js'
            const resp = await bgSend({ cmd: 'fetchPen', url: penUrl });
            let js;
            if (resp && resp.html) {
                js = extractJsFromHtml1(resp.html);
                console.log('Extracted JS:\n', js);
            } else {
                console.warn('No HTML returned from background fetch', resp);
            }

            // const corsProxy = 'https://cors-anywhere.herokuapp.com/';
            // const jsUrl = corsProxy + penUrl.replace('/pen/', '/pen/') + '.js';
            // const js = await fetch(jsUrl).then(r => r.text());

            // const fetch = require('node-fetch');

            // const jsUrl = penUrl + '.js';
            // const res = await fetch(jsUrl);
            // const js = await res.text();
            // console.log(js);
            // try {
            //     const pen = await fetchPenFromUrl(penUrl);
            //     console.log("FOUND JS: ");
            //     console.log(pen.js);

            // } catch (error) {
            //     console.log(error);

            // }
            // const js = await fetchPenJS("Narek-Hovsepyan-the-encoder", "OPNjPrw");
            // let user = "Narek-Hovsepyan-the-encoder";
            // let slug = "OPNjPrw";
            // const jsUrl = `https://cors-anywhere.herokuapp.com/https://codepen.io/${user}/pen/${slug}.js`;
            // const js = await fetch(jsUrl).then(r => r.text());

            // console.log("Fetched JS:", js);


            const result = checkSyntax(js);
            if (!result.ok) {
                anyFail = true;
                details.push({ pen: penUrl, reason: result.error });
                break;
            } else {
                details.push({ pen: penUrl, reason: 'OK' });
            }
            // }

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