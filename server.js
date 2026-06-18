const express = require('express');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// BlueDart Configuration
const BLUEDART_CONFIG = {
    loginId: process.env.BLUEDART_LOGIN_ID || 'BOM05840',
    licenseKey: process.env.BLUEDART_LICENSE_KEY || 'nfjmmrtlhrotqhffovjfromhvtktvshr',
    version: '1.3'
};

// GATI Configuration
const GATI_CONFIG = {
    custCode: process.env.GATI_CUST_CODE || '87654321',
    authToken: process.env.GATI_AUTH_TOKEN || '357E89F08D4AFFE1'
};

// Xpresion Configuration
const XPRESION_CONFIG = {
    userId: process.env.XPRESION_USER_ID || 'CARD',
    password: process.env.XPRESION_PASSWORD || 'A2F61EDB3E'
};

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

        const url = `https://api.bluedart.com/servlet/RoutingServlet?handler=tnt&action=custawbquery&loginid=${BLUEDART_CONFIG.loginId}&awb=awb&numbers=${awbNo}&format=xml&lickey=${BLUEDART_CONFIG.licenseKey}&verno=${BLUEDART_CONFIG.version}&scan=0`;

        const response = await axios.get(url, { timeout: 8000 });
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(response.data);

        if (result.BlueDartResponse && result.BlueDartResponse.AWB) {
            const awbData = result.BlueDartResponse.AWB[0];
            
            const tracking = {
                awbNo: awbNo,
                status: awbData.$ ? awbData.$.Status : 'Unknown',
                receiverName: awbData.Receiver ? awbData.Receiver[0] : 'N/A',
                currentLocation: awbData.CurrentLocation ? awbData.CurrentLocation[0] : 'N/A',
                destination: awbData.Destination ? awbData.Destination[0] : 'N/A',
                origin: awbData.Origin ? awbData.Origin[0] : 'N/A',
                events: []
            };

            if (awbData.Event && Array.isArray(awbData.Event)) {
                tracking.events = awbData.Event.map(event => ({
                    eventDate: event.$ ? event.$.Date : '',
                    eventTime: event.$ ? event.$.Time : '',
                    location: event.$ ? event.$.Location : '',
                    status: event.$ ? event.$.Status : ''
                }));
            }

            return res.json({ success: true, tracking, provider: 'bluedart' });
        }

        return res.json({ success: false, error: 'AWB not found' });
    } catch (error) {
        console.error('BlueDart Error:', error.message);
        return res.status(400).json({
            success: false,
            error: 'Error tracking with BlueDart',
            details: error.message
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

        const url = `https://pg-uat.gati.com/pickupservices/GatiKWEDktJTrack.jsp?p1=${docketNo}&p2=${GATI_CONFIG.authToken}`;
        
        const response = await axios.get(url, { timeout: 8000 });
        
        // Parse GATI response
        const tracking = {
            docketNo: docketNo,
            status: response.data.DOCKET_STATUS || 'Unknown',
            location: response.data.DELIVERY_STATION || 'In Transit',
            transitDetails: response.data.TRANSIT_DTLS || []
        };

        return res.json({ success: true, tracking, provider: 'gati' });
    } catch (error) {
        console.error('GATI Error:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Error tracking with GATI',
            details: error.message
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

        const payload = {
            UserID: XPRESION_CONFIG.userId,
            Password: XPRESION_CONFIG.password,
            AWB: awbNo,
            Fromdate: '',
            Todate: ''
        };

        const response = await axios.post('https://epsm.xpresion.in/api/v1/Tracking/Tracking', payload, {
            timeout: 8000,
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data.Status === 'S' && response.data.Data) {
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
            error: 'Error tracking with Xpresion',
            details: error.message
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

// Export for Vercel
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ EPS Backend running on port ${PORT}`);
});

module.exports = app;
