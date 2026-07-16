let interval;

self.onmessage = function(e) {
    if (e.data === 'start') {
        clearInterval(interval);
        interval = setInterval(() => {
            self.postMessage('tick');
        }, 1000);
    } else if (e.data === 'stop') {
        clearInterval(interval);
    }
};