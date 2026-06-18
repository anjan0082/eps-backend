module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  res.json({
    status: 'OK',
    service: 'EPS Worldwide Backend',
    providers: ['bluedart', 'gati', 'xpresion'],
    timestamp: new Date().toISOString()
  });
};
