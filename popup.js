document.getElementById('start').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const autoNext = document.getElementById('autoNext').checked;
    chrome.runtime.sendMessage({ action: 'start', autoNext }, (resp) => {
        console.log('start response', resp);
        if (!resp || !resp.ok) {
            alert('Could not start: ' + (resp?.reason || 'unknown'));
        }
    });
});

document.getElementById('stop').addEventListener('click', async () => {
    chrome.runtime.sendMessage({ action: 'stop' }, (resp) => {
        console.log('stop response', resp);
    });
});

