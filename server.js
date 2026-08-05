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

// NOTE: /api/track-bluedart and /api/track-gati were removed from the
// active flow. BlueDart credentials were unreliable (frequent "License
// Mismatch" errors) and GATI's endpoint pointed at a UAT/test environment
// that couldn't reliably report "not found" vs "found", which caused
// tracking to show fabricated data. Xpresion already aggregates data from
// both of those vendors (and others), so it's now the single source used
// for public tracking. The old route handlers are preserved in git history
// if they're ever needed again.

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

        // These match Xpresion's own working curl example for this
        // endpoint - CARD / A2F61EDB3E are real production credentials
        // (not placeholders), which is why calls were still failing even
        // with them: the request body shape was wrong, not the auth.
        const userId = process.env.XPRESION_USER_ID || 'CARD';
        const password = process.env.XPRESION_PASSWORD || 'A2F61EDB3E';

        // BUG FIX: the payload previously sent "AWB" as the field name and
        // included "Fromdate"/"Todate", neither of which match Xpresion's
        // actual API contract. Xpresion's confirmed working curl example
        // uses "AWBNo" plus "ShowAllFields"/"RequiredUrl" - the mismatched
        // field name meant Xpresion likely never recognized the AWB being
        // queried at all, regardless of whether credentials were valid.
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

        // BUG FIX: this used to check response.data.Data, but Xpresion's
        // real response shape nests everything under response.data.Response
        // instead - { Response: { ErrorCode, Tracking: [...], Events: [...],
        // AdditionalData: [...], ... } }. There is no top-level "Data" field
        // at all, so this check always failed and reported "AWB not found"
        // even when Xpresion had valid, complete tracking data (confirmed
        // via a direct curl test against the same endpoint/credentials).
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
