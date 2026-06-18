const axios = require('axios');
const xml2js = require('xml2js');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { awbNo } = req.body;
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

    if (result.BlueDartResponse?.AWB?.[0]) {
      const awbData = result.BlueDartResponse.AWB[0];
      const tracking = {
        awbNo,
        status: awbData.$?.Status || 'Unknown',
        receiverName: awbData.Receiver?.[0] || 'N/A',
        currentLocation: awbData.CurrentLocation?.[0] || 'N/A',
        events: awbData.Event ? awbData.Event.map(e => ({
          date: e.$?.Date,
          time: e.$?.Time,
          location: e.$?.Location,
          status: e.$?.Status
        })) : []
      };
      return res.json({ success: true, tracking });
    }

    return res.status(400).json({ success: false, error: 'AWB not found' });
  } catch (error) {
    console.error('BlueDart:', error.message);
    return res.status(400).json({ success: false, error: error.message });
  }
}
