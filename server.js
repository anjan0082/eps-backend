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

// Startup check — warn loudly if BlueDart credentials aren't coming from
// real environment variables. Relying on the hardcoded fallbacks below is
// what caused the "License Mismatch" bug (the old fallback had a typo'd key).
if (!process.env.BLUEDART_LOGIN_ID || !process.env.BLUEDART_LICENSE_KEY) {
    console.warn('⚠️  BLUEDART_LOGIN_ID / BLUEDART_LICENSE_KEY not set as environment variables.');
    console.warn('⚠️  Falling back to hardcoded defaults — set these in Vercel Project Settings > Environment Variables for Production.');
}

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
        // FIX: previous fallback key had two transposed characters
        // ("...hffvoj...") which does not match the key BlueDart issued
        // ("...hffovj..."). That mismatch was the root cause of the
        // "License Mismatch" error whenever the env var wasn't set.
        const licenseKey = process.env.BLUEDART_LICENSE_KEY || 'nfjmmrtlhrotqhffovjfromhvtktvshr';

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

        // Check for ShipmentData > Shipment (correct structure)
        if (result.ShipmentData && result.ShipmentData.Shipment) {
            const shipment = result.ShipmentData.Shipment[0];

            // Surface BlueDart's own <Error> node (e.g. "License Mismatch",
            // "Incorrect waybill number") instead of masking it as a generic
            // 400 — makes future debugging much faster.
            const bdError = shipment.Error ? shipment.Error[0] : null;
            if (bdError) {
                console.error('BlueDart returned an error node:', bdError);
                return res.status(400).json({
                    success: false,
                    error: `BlueDart error: ${bdError}`,
                    waybillNo: shipment.$?.WaybillNo || awbNo
                });
            }

            const tracking = {
                awbNo: awbNo,
                status: shipment.$?.Status || 'In Transit',
                receiverName: shipment.Receiver ? shipment.Receiver[0] : 'N/A',
                currentLocation: shipment.CurrentLocation ? shipment.CurrentLocation[0] : 'N/A',
                service: shipment.Service ? shipment.Service[0] : 'N/A',
                origin: shipment.Origin ? shipment.Origin[0] : 'N/A',
                destination: shipment.Destination ? shipment.Destination[0] : 'N/A',
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

        console.log('GATI Raw Response:', response.data);

        // BUG FIX: this used to ignore response.data entirely and always
        // return a hardcoded { status: 'In Transit', location: 'GATI Network' }
        // object, so every AWB — including ones that were never shipped via
        // GATI at all (e.g. Xpresion-only AWBs) — came back as a fake
        // "success" with fabricated GATI data. That masked real failures and
        // stopped the frontend's BlueDart -> GATI -> Xpresion fallback chain
        // from ever reaching Xpresion, which has the actual delivery status.
        //
        // GATI's tracking servlet returns plain text/HTML, not JSON, so we
        // can't reliably decode a structured status from it — but we CAN
        // tell whether it found a real record. Treat empty/error/"not
        // found"-style responses as a miss and let the caller fall through
        // to the next provider instead of lying about success.
        const raw = (response.data || '').toString();
        const noRecordPattern = /no record|not found|invalid|no data|does not exist/i;
        const looksEmpty = raw.trim().length === 0;

        if (looksEmpty || noRecordPattern.test(raw)) {
            return res.status(404).json({
                success: false,
                error: 'AWB not found in GATI',
                rawResponse: raw.substring(0, 500)
            });
        }

        const tracking = {
            docketNo: docketNo,
            status: 'In Transit',
            location: 'GATI Network',
            message: 'Tracking via GATI',
            rawResponse: raw.substring(0, 1000)
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
