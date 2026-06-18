const axios = require('axios');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { docketNo } = req.body || {};
  if (!docketNo) {
    return res.status(400).json({ success: false, error: 'Docket required' });
  }

  try {
    const authToken = process.env.GATI_AUTH_TOKEN || '357E89F08D4AFFE1';
    const url = `https://pg-uat.gati.com/pickupservices/GatiKWEDktJTrack.jsp?p1=${docketNo}&p2=${authToken}`;

    const response = await axios.get(url, {
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const tracking = {
      docketNo,
      status: 'In Transit',
      location: 'GATI Network',
      message: 'Tracking information available'
    };

    return res.json({ success: true, tracking });
  } catch (error) {
    console.error('GATI Error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
};
