const axios = require('axios');
const xml2js = require('xml2js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.path === '/health') {
    return res.json({
      status: 'OK',
      service: 'EPS Worldwide Backend',
      providers: ['bluedart', 'gati', 'xpresion']
    });
  }
  
  res.status(404).json({ error: 'Use /api/health or /api/track-* endpoints' });
};
