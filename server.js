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
        providers: ['xpresion'],
        timestamp: new Date().toISOString()
    });
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
            AWBNo: awbNo,
            ShowAllFields: 'Yes',
            RequiredUrl: 'Yes'
        };

        const response = await axios.post('https://epsm.xpresion.in/api/v1/Tracking/Tracking', payload, {
            timeout: 5000,
            headers: { 'Content-Type': 'application/json' }
        });

        console.log('Xpresion Raw Response:', JSON.stringify(response.data));

        const xpResponse = response.data && response.data.Response;
        const trackingSummary = xpResponse && xpResponse.Tracking && xpResponse.Tracking[0];

        if (xpResponse && xpResponse.ErrorCode === '0' && trackingSummary) {
            const events = (xpResponse.Events || []).map(e => ({
                date: e.EventDate1 || e.EventDate,
                time: e.EventTime1 || e.EventTime,
                location: e.Location,
                status: e.Status
            }));

            return res.json({
                success: true,
                provider: 'xpresion',
                tracking: {
                    awbNo: trackingSummary.AWBNo,
                    status: trackingSummary.Status,
                    origin: trackingSummary.Origin,
                    destination: trackingSummary.Destination,
                    consignee: trackingSummary.Consignee,
                    shipperName: trackingSummary.Shipper_Name,
                    bookingDate: trackingSummary.BookingDate1 || trackingSummary.BookingDate,
                    deliveryDate: trackingSummary.DeliveryDate1 || trackingSummary.DeliveryDate,
                    events
                }
            });
        }

        return res.json({
            success: false,
            error: (xpResponse && xpResponse.ErrorDisc) || 'AWB not found'
        });
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
