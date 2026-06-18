const express = require('express');
const cors = require('cors');
const axios = require('axios');
const xml2js = require('xml2js');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// GATI Logistics Configuration
const GATI_CONFIG = {
    test: {
        baseUrl: 'https://pg-uat.gati.com/pickupservices',
        custCode: process.env.GATI_CUST_CODE || '87654321', // Test customer code
        authToken: process.env.GATI_AUTH_TOKEN || '357E89F08D4AFFE1' // Test token
    },
    prod: {
        baseUrl: 'https://justi.gati.com/webservices',
        custCode: process.env.GATI_CUST_CODE_PROD || '87654321',
        authToken: process.env.GATI_AUTH_TOKEN_PROD || '357E89F08D4AFFE1'
    }
};

const GATI = GATI_CONFIG[process.env.NODE_ENV === 'production' ? 'prod' : 'test'];

// Xpresion Configuration
const XPRESION_CONFIG = {
    baseUrl: 'https://epsm.xpresion.in/api/v1/Tracking/Tracking',
    userId: process.env.XPRESION_USER_ID || 'CARD',
    password: process.env.XPRESION_PASSWORD || 'A2F61EDB3E'
};

// BlueDart Configuration
const BLUEDART_CONFIG = {
    baseUrl: 'https://api.bluedart.com/servlet/RoutingServlet',
    loginId: process.env.BLUEDART_LOGIN_ID || 'BOM05840',
    licenseKey: process.env.BLUEDART_LICENSE_KEY || 'nfjmmrtlhrotqhffovjfromhvtktvshr',
    version: '1.3'
};

/**
 * GATI Tracking Endpoint
 * GET /api/track-gati
 * Body: { docketNo: "163127931" }
 */
app.post('/api/track-gati', async (req, res) => {
    try {
        const { docketNo } = req.body;

        if (!docketNo) {
            return res.status(400).json({ 
                success: false, 
                error: 'Docket number is required' 
            });
        }

        // Call GATI Tracking API
        const url = `${GATI.baseUrl}/GatiKWEDktJTrack.jsp?p1=${encodeURIComponent(docketNo)}&p2=${encodeURIComponent(GATI.authToken)}`;

        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'EPS-Worldwide/1.0'
            }
        });

        const gatiResponse = response.data;

        // Parse GATI response
        if (gatiResponse.Gatiresponse && gatiResponse.Gatiresponse.dktinfo && gatiResponse.Gatiresponse.dktinfo.length > 0) {
            const dktInfo = gatiResponse.Gatiresponse.dktinfo[0];

            if (dktInfo.result === 'successful' && !dktInfo.errmsg) {
                const tracking = {
                    docketNo: dktInfo.DOCKET_NUMBER,
                    status: dktInfo.DOCKET_STATUS,
                    consignorName: dktInfo.CONSIGNOR_NAME,
                    consigneeName: dktInfo.CONSIGNEE_NAME,
                    bookingStation: dktInfo.BOOKING_STATION,
                    deliveryStation: dktInfo.DELIVERY_STATION,
                    bookedDate: dktInfo.BOOKED_DATETIME,
                    assuredDeliveryDate: dktInfo.ASSURED_DELIVERY_DATE,
                    actualWeight: dktInfo.ACTUAL_WEIGHT,
                    noOfPkgs: dktInfo.NO_OF_PKGS,
                    serviceName: dktInfo.SERVICE_NAME,
                    location: dktInfo.DELIVERY_STATION,
                    transitDetails: dktInfo.TRANSIT_DTLS ? dktInfo.TRANSIT_DTLS.map(transit => ({
                        date: transit.INTRANSIT_DATE,
                        time: transit.INTRANSIT_TIME,
                        location: transit.INTRANSIT_LOCATION,
                        status: transit.INTRANSIT_STATUS,
                        statusCode: transit.INTRANSIT_STATUS_CODE,
                        reasonCode: transit.REASON_CODE || '',
                        reasonDesc: transit.REASON_DESC || ''
                    })) : []
                };

                return res.status(200).json({
                    success: true,
                    tracking: tracking,
                    provider: 'gati'
                });
            } else {
                return res.status(400).json({
                    success: false,
                    error: dktInfo.errmsg || 'Unable to track docket',
                    provider: 'gati'
                });
            }
        } else {
            return res.status(400).json({
                success: false,
                error: 'Invalid response from GATI',
                provider: 'gati'
            });
        }
    } catch (error) {
        console.error('GATI Tracking Error:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Error fetching GATI tracking information',
            details: error.message,
            provider: 'gati'
        });
    }
});

/**
 * Xpresion Tracking Endpoint
 * POST /api/track-xpresion
 * Body: { awbNo: "AWB123456" }
 */
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

        const response = await axios.post(XPRESION_CONFIG.baseUrl, payload, {
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.data.Status === 'S' && response.data.Data && response.data.Data.length > 0) {
            const tracking = response.data.Data[0];
            return res.status(200).json({
                success: true,
                tracking: tracking,
                provider: 'xpresion'
            });
        } else {
            return res.status(400).json({
                success: false,
                error: response.data.Error || 'AWB not found',
                provider: 'xpresion'
            });
        }
    } catch (error) {
        console.error('Xpresion Tracking Error:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Error fetching Xpresion tracking information',
            details: error.message,
            provider: 'xpresion'
        });
    }
});

/**
 * BlueDart Tracking Endpoint
 * POST /api/track-bluedart
 * Body: { awbNo: "15616373625" }
 */
app.post('/api/track-bluedart', async (req, res) => {
    try {
        const { awbNo } = req.body;

        if (!awbNo) {
            return res.status(400).json({
                success: false,
                error: 'AWB number is required'
            });
        }

        const url = `${BLUEDART_CONFIG.baseUrl}?handler=tnt&action=custawbquery&loginid=${BLUEDART_CONFIG.loginId}&awb=awb&numbers=${awbNo}&format=xml&lickey=${BLUEDART_CONFIG.licenseKey}&verno=${BLUEDART_CONFIG.version}&scan=0`;

        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'EPS-Worldwide/1.0'
            }
        });

        // Parse XML response
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(response.data);

        // Check for BlueDart API errors
        if (result.BlueDartResponse && result.BlueDartResponse.AWB) {
            const awbData = result.BlueDartResponse.AWB[0];

            if (awbData.$ && awbData.$.error && awbData.$.error !== '0') {
                return res.status(400).json({
                    success: false,
                    error: awbData.$.message || 'AWB not found or invalid',
                    provider: 'bluedart'
                });
            }

            // Extract tracking details
            const tracking = {
                awbNo: awbNo,
                status: awbData.$.Status || 'Unknown',
                receiverName: awbData.Receiver ? awbData.Receiver[0] : 'N/A',
                currentLocation: awbData.CurrentLocation ? awbData.CurrentLocation[0] : 'N/A',
                destination: awbData.Destination ? awbData.Destination[0] : 'N/A',
                origin: awbData.Origin ? awbData.Origin[0] : 'N/A',
                serviceType: awbData.$.ServiceType || 'Standard',
                events: []
            };

            // Parse delivery events
            if (awbData.Event && Array.isArray(awbData.Event)) {
                tracking.events = awbData.Event.map(event => ({
                    eventDate: event.$.Date || '',
                    eventTime: event.$.Time || '',
                    location: event.$.Location || '',
                    status: event.$.Status || '',
                    eventDetails: event._ || ''
                }));
            }

            return res.status(200).json({
                success: true,
                tracking: tracking,
                provider: 'bluedart'
            });
        } else {
            return res.status(400).json({
                success: false,
                error: 'Invalid response from BlueDart',
                provider: 'bluedart'
            });
        }
    } catch (error) {
        console.error('BlueDart Tracking Error:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Error fetching BlueDart tracking information',
            details: error.message,
            provider: 'bluedart'
        });
    }
});

/**
 * GATI PinCode Validation
 * GET /api/gati-pincode/:pincode
 */
app.get('/api/gati-pincode/:pincode', async (req, res) => {
    try {
        const { pincode } = req.params;

        if (!pincode) {
            return res.status(400).json({
                success: false,
                error: 'Pincode is required'
            });
        }

        const url = `${GATI.baseUrl}/GKEPincodeserviceablity.jsp?reqid=${encodeURIComponent(GATI.authToken)}&pincode=${encodeURIComponent(pincode)}`;

        const response = await axios.post(url, {}, {
            timeout: 10000,
            headers: {
                'User-Agent': 'EPS-Worldwide/1.0'
            }
        });

        if (response.data.result === 'successful') {
            return res.status(200).json({
                success: true,
                serviceable: true,
                services: response.data.serviceDtls || [],
                provider: 'gati'
            });
        } else {
            return res.status(400).json({
                success: false,
                serviceable: false,
                error: 'Pincode not serviceable',
                provider: 'gati'
            });
        }
    } catch (error) {
        console.error('GATI Pincode Validation Error:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Error validating pincode',
            details: error.message,
            provider: 'gati'
        });
    }
});

/**
 * Health Check Endpoint
 */
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        service: 'EPS Worldwide Backend',
        providers: ['xpresion', 'gati', 'bluedart'],
        timestamp: new Date().toISOString()
    });
});

/**
 * 404 Handler
 */
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.path
    });
});

/**
 * Error Handler
 */
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ EPS Worldwide Backend Server running on port ${PORT}`);
    console.log(`📍 GATI Provider: ${GATI.baseUrl}`);
    console.log(`📍 Xpresion Provider: ${XPRESION_CONFIG.baseUrl}`);
});

module.exports = app;
