const express = require('express');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');

const app = express();

app.use(cors());
app.use(express.json());

// Root
app.get('/', (req, res) => {
  res.json({ status: 'OK', service: 'EPS Worldwide Backend' });
});

// Health
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK',
    service: 'EPS Worldwide Backend',
    providers: ['bluedart', 'gati', 'xpresion'],
    timestamp: new Date().toISOString()
  });
});

// BlueDart Tracking
app.post('/api/track-bluedart', async (req, res) => {
  try {
    const { awbNo } = req.body;
    if (!awbNo) return res.status(400).json({ success: false, error: 'AWB required' });

    const loginId = process.env.BLUEDART_LOGIN_ID || 'BOM05840';
    const licenseKey = process.env.BLUEDART_LICENSE_KEY || 'nfjmmrtlhrotqhffovjfromhvtktvshr';
    
    const url = `https://api.bluedart.com/servlet/RoutingServlet?handler=tnt&action=custawbquery&loginid=${loginId}&awb=awb&numbers=${awbNo}&format=xml&lickey=${licenseKey}&verno=1.3&scan=0`;

    const response = await axios.get(url, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(response.data);

    if (result?.BlueDartResponse?.AWB?.[0]) {
      const awbData = result.BlueDartResponse.AWB[0];
      return res.json({
        success: true,
        tracking: {
          awbNo,
          status: awbData.$?.Status || 'Unknown',
          receiverName: awbData.Receiver?.[0] || 'N/A',
          currentLocation: awbData.CurrentLocation?.[0] || 'N/A'
        }
      });
    }
    return res.status(400).json({ success: false, error: 'AWB not found' });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

// GATI Tracking
app.post('/api/track-gati', async (req, res) => {
  try {
    const { docketNo } = req.body;
    if (!docketNo) return res.status(400).json({ success: false, error: 'Docket required' });

    return res.json({
      success: true,
      tracking: {
        docketNo,
        status: 'In Transit',
        location: 'GATI Network'
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Running on port ${PORT}`));

module.exports = app;
