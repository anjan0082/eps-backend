const express = require('express');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Supabase client for the fuel surcharge cache (reuses the SUPABASE_URL /
// SUPABASE_SERVICE_KEY / SUPABASE_KEY env vars already set on this project).
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;
if (!supabase) {
    console.warn('SUPABASE_URL/SUPABASE_SERVICE_KEY not set - /api/fuel-surcharge endpoints will be disabled.');
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

// ===================== Fuel Surcharge (auto-pulled from BlueDart) =====================
// BlueDart publishes its fuel surcharge rates at these two public pages and
// updates them itself (domestic ~monthly, international ~weekly). Instead of
// hardcoding a rate in the frontend that goes stale, we scrape both pages on
// a schedule (see the "crons" entry in vercel.json, which hits
// /api/cron/update-fuel-surcharge weekly) and cache the parsed rows in
// Supabase. The frontend reads the cached rows from /api/fuel-surcharge.

const FUEL_SURCHARGE_MONTHS = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
};

function parseBlueDartDate(text) {
    // Handles both "01 July, 2026" (domestic table) and "03 August 2026"
    // (international table) formats.
    const match = (text || '').replace(',', '').trim().match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    if (!match) return null;
    const [, day, monthName, year] = match;
    const month = FUEL_SURCHARGE_MONTHS[monthName.toLowerCase()];
    if (month === undefined) return null;
    const date = new Date(Date.UTC(Number(year), month, Number(day)));
    return isNaN(date.getTime()) ? null : date;
}

async function fetchBlueDartTable(url, mustContain) {
    const { data: html } = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const $ = cheerio.load(html);
    let targetTable = null;
    $('table').each((_, table) => {
        if (targetTable) return;
        const headerText = $(table).find('tr').first().text();
        if (/Effective Date/i.test(headerText) && new RegExp(mustContain, 'i').test(headerText)) {
            targetTable = table;
        }
    });
    if (!targetTable) return [];

    const rows = [];
    $(targetTable).find('tr').slice(1).each((_, tr) => {
        const cells = $(tr).find('td, th').map((__, el) => $(el).text().trim()).get();
        if (cells.length >= 2) {
            const effectiveDate = parseBlueDartDate(cells[0]);
            const percentage = parseFloat(cells[1].replace('%', ''));
            if (effectiveDate && !isNaN(percentage)) {
                rows.push({ effective_date: effectiveDate.toISOString().slice(0, 10), percentage });
            }
        }
    });
    return rows;
}

async function scrapeFuelSurcharge() {
    const [domesticRows, internationalRows] = await Promise.all([
        fetchBlueDartTable('https://www.bluedart.com/fuel-surcharge', 'Domestic'),
        fetchBlueDartTable('https://www.bluedart.com/international-fuel-surcharge', 'International')
    ]);
    return { domesticRows, internationalRows };
}

// GET current + recent-history fuel surcharge rates for the frontend banner/modal.
app.get('/api/fuel-surcharge', async (req, res) => {
    try {
        if (!supabase) {
            return res.status(503).json({ success: false, error: 'Fuel surcharge storage not configured' });
        }
        const { data, error } = await supabase
            .from('fuel_surcharge_rates')
            .select('type, effective_date, percentage')
            .order('effective_date', { ascending: false });
        if (error) throw error;

        const domestic = (data || []).filter(r => r.type === 'domestic');
        const international = (data || []).filter(r => r.type === 'international');

        return res.json({
            success: true,
            current: {
                domestic: domestic[0] || null,
                international: international[0] || null
            },
            history: {
                domestic: domestic.slice(0, 12),
                international: international.slice(0, 10)
            }
        });
    } catch (error) {
        console.error('Fuel Surcharge Fetch Error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// Scrapes BlueDart and upserts the latest rows into Supabase. Triggered on a
// schedule by Vercel Cron (see vercel.json), but can also be hit manually.
// If a CRON_SECRET env var is set, requests must include it as
// "Authorization: Bearer <CRON_SECRET>".
app.get('/api/cron/update-fuel-surcharge', async (req, res) => {
    try {
        const cronSecret = process.env.CRON_SECRET;
        if (cronSecret) {
            const authHeader = req.headers['authorization'];
            if (authHeader !== `Bearer ${cronSecret}`) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
        }
        if (!supabase) {
            return res.status(503).json({ success: false, error: 'Fuel surcharge storage not configured' });
        }

        const { domesticRows, internationalRows } = await scrapeFuelSurcharge();
        const rows = [
            ...domesticRows.map(r => ({ type: 'domestic', ...r })),
            ...internationalRows.map(r => ({ type: 'international', ...r }))
        ].map(r => ({ ...r, updated_at: new Date().toISOString() }));

        if (rows.length === 0) {
            return res.status(502).json({ success: false, error: 'Could not parse BlueDart fuel surcharge pages - site layout may have changed' });
        }

        const { error } = await supabase
            .from('fuel_surcharge_rates')
            .upsert(rows, { onConflict: 'type,effective_date' });
        if (error) throw error;

        return res.json({
            success: true,
            updated: rows.length,
            domesticLatest: domesticRows[0] || null,
            internationalLatest: internationalRows[0] || null
        });
    } catch (error) {
        console.error('Fuel Surcharge Update Error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
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
