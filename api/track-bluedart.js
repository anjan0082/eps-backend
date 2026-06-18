const axios = require('axios');
const xml2js = require('xml2js');

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

  const { awbNo } = req.body || {};
  if (!awbNo) {
    return res.status(400).json({ success: false, error: 'AWB required' });
  }

  try {
    const loginId = process.env.BLUEDART_LOGIN_ID || 'BOM05840';
    const licenseKey = process.env.BLUEDART_LICENSE_KEY || 'nfjmmrtlhrotqhffovjfromhvtktvshr';
    
    const url = `https://api.bluedart.com/servlet/RoutingServlet?handler=tnt&action=custawbquery&loginid=${loginId}&awb=awb&numbers=${awbNo}&format=xml&lickey=${licenseKey}&verno=1.3&scan=0`;

    const response = await axios.get(url, {
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(response.data);

    if (result && result.BlueDartResponse && result.BlueDartResponse.AWB && result.BlueDartResponse.AWB[0]) {
      const awbData = result.BlueDartResponse.AWB[0];
      const tracking = {
        awbNo,
        status: (awbData.$ && awbData.$.Status) ? awbData.$.Status : 'Unknown',
        receiverName: awbData.Receiver ? awbData.Receiver[0] : 'N/A',
        currentLocation: awbData.CurrentLocation ? awbData.CurrentLocation[0] : 'N/A'
      };
      return res.json({ success: true, tracking });
    }

    return res.status(400).json({ success: false, error: 'AWB not found' });
  } catch (error) {
    console.error('BlueDart Error:', error.message);
    return res.status(400).json({ success: false, error: error.message });
  }
};
