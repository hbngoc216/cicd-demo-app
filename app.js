const express = require('express');

const app = express();

app.get('/', (req, res) => {
  res.send('Hello World from Node.js CI/CD Demo!-27-8-2026-v2');
});

app.get('/health', (req,res) => {
  res.status(200).json({
      status: 'OK',
      application: 'demo-app'
  });
});

module.exports = app;


