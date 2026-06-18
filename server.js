const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Root
app.get('/', (req, res) => {
  res.json({ status: 'OK', service: 'EPS Worldwide Backend' });
});

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'OK', providers: ['bluedart', 'gati', 'xpresion'] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));

module.exports = app;
