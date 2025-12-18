// const STUDENT_CONTAINER_SELECTOR = "div.examiner-task-text-answer-content";
const STUDENT_CONTAINER_SELECTOR = "div.examiner-activity-container-components-wrapper";
const EXAMINER_COMPONENT_SELECTOR = "div.examiner-component-feedback";
const CODEPEN_LINK_SELECTOR = "a[href*='codepen.io']";
const LINK_SELECTOR = "div.examiner-task-text-answer-content";
const AWARD_BUTTON_SELECTOR = "button.examiner-component-feedback-status-button-award";
const REJECT_BUTTON_SELECTOR = "button.examiner-component-feedback-status-button-reject";
// const REJECT_BUTTON_SELECTOR = "button.examiner-component-feedback-status-button-reject.feedback-status-buttons-focus.v-btn.v-btn--outlined.theme--dark.v-size--default.examiner-tab-stop";
// const NEXT_BUTTON_SELECTOR = "button.examiner-next-and-save-button.v-btn v-btn--text.theme--light.v-size--large";
const NEXT_BUTTON_SELECTOR = "button.examiner-next-button.v-btn.v-btn--has-bg.theme--light.v-size--large.examiner-tab-stop";
const REJECT_LIST_SELECTOR = "div.v-item-group.theme--light.v-list-item-group";
const ACTIVITY_COMPONENT_SELECOR = "div.examiner-activity-container-components-wrapper";
const FINAL_FEEDBACK_SELECTOR = "div.v-select__slot";

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
function bySelectorOrTextAll(selectorStr, root = document) {
    const parts = selectorStr.split(',').map(p => p.trim());
    const results = [];

    for (const part of parts) {
        if (part.includes(':contains(')) {
            const m = part.match(/:contains\(['"]?(.*?)['"]?\)/);
            if (!m) continue;
            const txt = m[1].toLowerCase();
            const els = Array.from(root.querySelectorAll('button, a, input, span, div'));

            for (const e of els) {
                if ((e.innerText || '').toLowerCase().includes(txt)) {
                    results.push(e);
                }
            }
        } else {
            results.push(...root.querySelectorAll(part));
        }
    }
    // console.log("RESULTS: ", results);

    return results;
}

async function fetchPenHTML(url) {
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

function checkSyntax(code) {
    try {
        new Function(code || '');
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message || String(e) };
    }
}
function checkSyntaxWithAcorn(code) {
    try {
        acorn.parse(code, { ecmaVersion: "latest", sourceType: "script", locations: true });
        return { valid: true, error: null, loc: null };
    } catch (err) {
        return {
            valid: false,
            error: err.message,
            loc: err.loc || null
        };
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

function extractJsCode(htmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, "text/html");

    const container = doc.querySelector("#box-js, .code-wrap, pre code, code");

    if (!container) return null;

    let codeTag = container.querySelector("code");
    if (!codeTag) codeTag = container;

    let code = codeTag.innerHTML;

    const txt = document.createElement("textarea");
    txt.innerHTML = code;
    code = txt.value;

    return code.trim();
}

function extractJs(htmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, "text/html");

    const box = doc.querySelector("#box-js");

    if (!box) return null;

    return extractJsCode(box.outerHTML);
}
let stopRequested = false;
let isProcessing = false;

function getListItems(root) {
    if (!root) return [];

    const container = root;
    console.log("container inside getListItems: ", container);

    if (!container) return [];

    return Array.from(container.querySelectorAll("input[type='checkbox'], [role='checkbox'], input[type='radio'], [role='radio']"
    ));

}

function isCodePenUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname === "codepen.io";
    } catch (e) {
        return false;
    }
}

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
            // const examinationRoot = document.querySelector(EXAMINER_COMPONENT_SELECTOR) || document;
            const examinationRoot = document.querySelector(ACTIVITY_COMPONENT_SELECOR) || document;
            const rejectEl = bySelectorOrTextAll(REJECT_BUTTON_SELECTOR);
            const awardEl = bySelectorOrTextAll(AWARD_BUTTON_SELECTOR);

            let pens = [];
            const divs = studentRoot.querySelectorAll(LINK_SELECTOR);

            if (!divs) {
                console.warn("Div not found");
                return;
            }
            divs.forEach(div => {
                const text = div.textContent.trim();
                pens.push(text);
            });

            let anyFail = false;
            const details = [];
            // const failedIndexes = [];
            // i is for tracking each exercise 
            let i = 0;
            // rejectIndx is for choosing reject reason from the list.
            // default is 1
            let rejectIndx = 1;
            const groups = Array.from(examinationRoot.querySelectorAll('.v-item-group.theme--light.v-list-item-group'));

            for (const penUrl of pens) {
                if (stopRequested) break;
                console.log('Fetching pen:', penUrl);
                if (!isCodePenUrl(penUrl)) {
                    anyFail = true;
                    details.push({ pen: penUrl, reason: 'Not a valid URL' });
                    rejectIndx = 0;
                    // continue;
                    if (rejectEl[i]) {
                        rejectEl[i].click();
                        // details.push(result.error);
                        console.log('Marking REJECT for this student. Details:', details);
                        // console.log("Syntax error:", result.error, "at", result.loc);
                        // let index = 2;
                        await new Promise(r => setTimeout(r, 1000));

                        // const groups = Array.from(examinationRoot.querySelectorAll('.v-item-group.theme--light.v-list-item-group'));
                        const desiredGroup = groups[i];

                        const items = getListItems(desiredGroup);
                        console.log(items);
                        if (!items[rejectIndx].checked) {
                            items[rejectIndx].click();
                        }
                    }
                }
                else {
                    const html = await fetchPenHTML(penUrl);
                    if (!html) {
                        anyFail = true;
                        details.push({ pen: penUrl, reason: 'Failed to fetch pen HTML' });
                        break;
                    }
                    const resp = await bgSend({ cmd: 'fetchPen', url: penUrl });
                    let js;
                    if (resp && resp.html) {
                        js = extractJs(resp.html);
                        // console.log('Extracted JS:\n', js);
                    } else {
                        console.warn('No HTML returned from background fetch', resp);
                    }

                    const result = checkSyntaxWithAcorn(js);
                    details.push(result.error);

                    if (result.valid) {
                        console.log("Syntax is correct!");
                        if (awardEl[i]) {
                            awardEl[i].click();
                            await new Promise(r => setTimeout(r, 500));

                            const desiredGroup = groups[i];
                            const items = getListItems(desiredGroup);
                            // console.log(items);
                            if (items.length == 0) {
                                const value = "Ապրես";
                                // const slots = document.querySelectorAll(".v-text-field__slot");
                                const slots = bySelectorOrTextAll("div.v-text-field__slot")
                                const input = slots[i].querySelector("input");

                                input.value = value;

                                input.dispatchEvent(new InputEvent("input", {
                                    bubbles: true,
                                    composed: true,
                                    data: value,
                                    inputType: "insertText"
                                }));
                                document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
                                document.body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
                                document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                            }
                        }
                        else {
                            console.warn('Award button not found; check AWARD_BUTTON_SELECTOR');
                        }
                    } else {
                        anyFail = true;
                        if (rejectEl[i]) {
                            rejectEl[i].click();
                            // details.push(result.error);
                            console.log('Marking REJECT for this student. Details:', details, "at ", result.loc);
                            // console.log("Syntax error:", result.error, "at", result.loc);
                            // let index = 2;
                            await new Promise(r => setTimeout(r, 1000));

                            // const groups = Array.from(examinationRoot.querySelectorAll('.v-item-group.theme--light.v-list-item-group'));
                            const desiredGroup = groups[i];

                            // console.log(`groups[${i}] = `, i, groups[i]);

                            const items = getListItems(desiredGroup);
                            // console.log(items);
                            if (!items[rejectIndx].checked) {
                                items[rejectIndx].click();
                            }
                        }
                        else {
                            console.warn('Reject button not found');
                        }
                        // failedIndexes.push(i);
                    }
                }
                i++;
            }
            const feedback = studentRoot.querySelector(FINAL_FEEDBACK_SELECTOR);
            // const feedback = studentRoot.querySelectorAll(".examiner-tab-stop");
            const input = feedback?.querySelector("input");
            const value = anyFail
                ? "Վերանայիր առաջադրանքը"
                : "Ապրես :)";

            feedback.dispatchEvent(new MouseEvent("mousedown", {
                bubbles: true,
                cancelable: true,
                view: window
            }));

            feedback.dispatchEvent(new MouseEvent("mouseup", {
                bubbles: true,
                cancelable: true,
                view: window
            }));

            feedback.dispatchEvent(new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                view: window
            }));

            input.value = value;

            input.dispatchEvent(new InputEvent("input", {
                bubbles: true,
                composed: true,
                data: value,
                inputType: "insertText"
            }));

            if (anyFail) {
                rejectEl[3].click();
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