const express = require('express');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root route
app.get('/', (req, res) => {
    res.json({
        status: 'OK',
        service: 'EPS Worldwide Backend',
        message: 'Use /health or /api/track-* endpoints'
    });
});

// Health Check
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
        
        if (!awbNo) {
            return res.status(400).json({
                success: false,
                error: 'AWB number is required'
            });
        }

        const loginId = process.env.BLUEDART_LOGIN_ID || 'BOM05840';
        const licenseKey = process.env.BLUEDART_LICENSE_KEY || 'nfjmmrtlhrotqhffvojfromhvtktvshr';
        
        const url = `https://api.bluedart.com/servlet/RoutingServlet?handler=tnt&action=custawbquery&loginid=${loginId}&awb=awb&numbers=${awbNo}&format=xml&lickey=${licenseKey}&verno=1.3&scan=0`;

        console.log('BlueDart Request URL:', url);

        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Accept': 'application/xml',
                'Connection': 'keep-alive'
            }
        });

        console.log('BlueDart Raw Response:', response.data);

        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(response.data);

        console.log('BlueDart Parsed Result:', JSON.stringify(result, null, 2));

        if (result.BlueDartResponse && result.BlueDartResponse.AWB) {
            const awbData = result.BlueDartResponse.AWB[0];
            
            const tracking = {
                awbNo: awbNo,
                status: awbData.$ ? awbData.$.Status : 'Unknown',
                receiverName: awbData.Receiver ? awbData.Receiver[0] : 'N/A',
                currentLocation: awbData.CurrentLocation ? awbData.CurrentLocation[0] : 'N/A',
                events: []
            };

            return res.json({ success: true, tracking, provider: 'bluedart' });
        }

        return res.status(400).json({ 
            success: false, 
            error: 'AWB not found in BlueDart',
            rawResponse: response.data.substring(0, 500)
        });
    } catch (error) {
        console.error('BlueDart Error:', error.message);
        console.error('BlueDart Error Details:', error);
        return res.status(400).json({
            success: false,
            error: 'Error tracking with BlueDart: ' + error.message
        });
    }
});

// GATI Tracking
app.post('/api/track-gati', async (req, res) => {
    try {
        const { docketNo } = req.body;
        
        if (!docketNo) {
            return res.status(400).json({
                success: false,
                error: 'Docket number is required'
            });
        }

        const custCode = process.env.GATI_CUST_CODE || '87654321';
        const authToken = process.env.GATI_AUTH_TOKEN || '357E89F08D4AFFE1';

        const url = `https://pg-uat.gati.com/pickupservices/GatiKWEDktJTrack.jsp?p1=${docketNo}&p2=${authToken}`;
        
        console.log('GATI Request:', url);

        const response = await axios.get(url, {
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });

        const tracking = {
            docketNo: docketNo,
            status: 'In Transit',
            location: 'GATI Network',
            message: 'Tracking via GATI'
        };

        return res.json({ success: true, tracking, provider: 'gati' });
    } catch (error) {
        console.error('GATI Error:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Error tracking with GATI: ' + error.message
        });
    }
});

// Xpresion Tracking
app.post('/api/track-xpresion', async (req, res) => {
    try {
        const { awbNo } = req.body;
        
        if (!awbNo) {
            return res.status(400).json({
                success: false,
                error: 'AWB number is required'
            });
        }

        const userId = process.env.XPRESION_USER_ID || 'CARD';
        const password = process.env.XPRESION_PASSWORD || 'A2F61EDB3E';

        const payload = {
            UserID: userId,
            Password: password,
            AWB: awbNo,
            Fromdate: '',
            Todate: ''
        };

        const response = await axios.post('https://epsm.xpresion.in/api/v1/Tracking/Tracking', payload, {
            timeout: 5000,
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data && response.data.Data) {
            return res.json({
                success: true,
                tracking: response.data.Data[0],
                provider: 'xpresion'
            });
        }

        return res.json({ success: false, error: 'AWB not found' });
    } catch (error) {
        console.error('Xpresion Error:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Error tracking with Xpresion: ' + error.message
        });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.path
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// Export for Vercel
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ EPS Backend running on port ${PORT}`);
});

module.exports = app;
