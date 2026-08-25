const http = require('http');
const app = require('./app');

const server = app.listen(0, () => {
    const port = server.address().port;

    http.get(`http://127.0.0.1:${port}/health`, (res) => {
        let data = '';

        res.on('data', chunk => {
            data += chunk;
        });

        res.on('end', () => {
            if (res.statusCode === 200 && data.includes('"status":"OK"')) {
                console.log('TEST PASSED: /health is working');
                server.close();
                process.exit(0);
            }

            console.error('TEST FAILED');
            server.close();
            process.exit(1);
        });
    }).on('error', (err) => {
        console.error('TEST FAILED:', err.message);
        server.close();
        process.exit(1);
    });
});
