module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    status: 'OK',
    service: 'EPS Worldwide Backend',
    providers: ['bluedart', 'gati', 'xpresion'],
    timestamp: new Date().toISOString()
  });
};
