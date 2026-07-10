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
// for public tracking.

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
