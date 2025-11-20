// document.getElementById('start').addEventListener('click', async () => {
//     const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
//     const autoNext = document.getElementById('autoNext').checked;
//     chrome.runtime.sendMessage({ action: 'start', autoNext });
//     // chrome.runtime.sendMessage({ action: 'start', autoNext }, response => {
//     //     // optional: response handling
//     // });
// });

// document.getElementById('stop').addEventListener('click', async () => {
//     chrome.runtime.sendMessage({ action: 'stop' });
// });


alert('hello from popup');