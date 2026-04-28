const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const https = require('https');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use(cors());
app.use(express.json());

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_live_ShG1B8BUg7cDW2';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'E1RPyDteeoRxzjCIlL86H5P3';

console.log('🔧 Razorpay Config:');
console.log('Key ID:', RAZORPAY_KEY_ID ? '✅ SET' : '❌ MISSING');
console.log('Key Secret:', RAZORPAY_KEY_SECRET ? '✅ SET' : '❌ MISSING');

// ============ HEALTH CHECK ============
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'EPS Backend v2 is running',
    razorpay: {
      keyId: RAZORPAY_KEY_ID ? '✅' : '❌',
      keySecret: RAZORPAY_KEY_SECRET ? '✅' : '❌'
    }
  });
});

// ============ GET ALL ORDERS ============
app.get('/api/orders', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('❌ Error fetching orders:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ CREATE ORDER ============
app.post('/api/orders', async (req, res) => {
  try {
    console.log('📝 Creating order:', req.body.eps_reference_code);
    const { data, error } = await supabase
      .from('orders')
      .insert([req.body])
      .select()
      .single();
    
    if (error) throw error;
    console.log('✅ Order created:', data.id);
    res.status(201).json(data);
  } catch (error) {
    console.error('❌ Error creating order:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ CREATE RAZORPAY ORDER ============
app.post('/api/razorpay/create-order', (req, res) => {
  try {
    const { amount, receipt, customer_email, customer_name } = req.body;

    console.log('💳 Creating Razorpay order...');
    console.log('Amount:', amount);
    console.log('Receipt:', receipt);

    const postData = JSON.stringify({
      amount: Math.round(amount * 100),
      currency: 'INR',
      receipt: receipt,
      notes: {
        customer_email: customer_email,
        customer_name: customer_name
      }
    });

    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');

    const options = {
      hostname: 'api.razorpay.com',
      port: 443,
      path: '/v1/orders',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    console.log('🔌 Connecting to Razorpay API...');

    const request = https.request(options, (response) => {
      let data = '';

      response.on('data', (chunk) => {
        data += chunk;
      });

      response.on('end', () => {
        try {
          console.log(`📥 Razorpay Response Status: ${response.statusCode}`);
          const parsedData = JSON.parse(data);
          
          if (response.statusCode === 200) {
            console.log('✅ Razorpay order created:', parsedData.id);
            res.json({
              success: true,
              razorpay_order_id: parsedData.id,
              amount: parsedData.amount,
              currency: parsedData.currency,
              status: parsedData.status
            });
          } else {
            console.error('❌ Razorpay Error:', parsedData);
            res.status(response.statusCode).json({
              success: false,
              error: parsedData.description || parsedData.error?.description || 'Failed to create order'
            });
          }
        } catch (error) {
          console.error('❌ Parse error:', error);
          res.status(500).json({ success: false, error: 'Invalid response from Razorpay' });
        }
      });
    });

    request.on('error', (error) => {
      console.error('❌ Razorpay Connection Error:', error);
      res.status(500).json({ success: false, error: error.message });
    });

    request.write(postData);
    request.end();
  } catch (error) {
    console.error('❌ Catch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ VERIFY RAZORPAY PAYMENT ============
app.post('/api/razorpay/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, order_id } = req.body;

    console.log('🔐 Verifying payment signature...');
    console.log('Order ID:', order_id);
    console.log('Payment ID:', razorpay_payment_id);

    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    const isValidSignature = expectedSignature === razorpay_signature;

    if (!isValidSignature) {
      console.error('❌ Invalid signature');
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid payment signature' 
      });
    }

    console.log('✅ Signature verified');

    // Update order in database
    const { data, error } = await supabase
      .from('orders')
      .update({ 
        payment_status: 'paid',
        order_status: 'confirmed',
        updated_at: new Date().toISOString()
      })
      .eq('id', order_id)
      .select()
      .single();

    if (error) throw error;

    console.log('✅ Order updated to paid');

    res.json({ 
      success: true, 
      message: 'Payment verified successfully',
      data 
    });
  } catch (error) {
    console.error('❌ Verification Error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// ============ UPDATE ORDER STATUS ============
app.patch('/api/orders/:id/status', async (req, res) => {
  try {
    const { new_status } = req.body;
    
    const { data, error } = await supabase
      .from('orders')
      .update({ 
        order_status: new_status,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .select()
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ XPRESION TRACKING ============
app.post('/api/xpresion/tracking', (req, res) => {
  try {
    const { awb_number } = req.body;

    if (!awb_number) {
      return res.status(400).json({ success: false, error: 'AWB number is required' });
    }

    console.log('📦 Xpresion Tracking Request for AWB:', awb_number);

    const postData = JSON.stringify({
      UserID: 'CARD',
      Password: 'A2F61EDB3E',
      AWBNo: awb_number,
      ShowAllFields: 'Yes',
      RequiredUrl: 'Yes'
    });

    const options = {
      hostname: 'epsm.xpresion.in',
      port: 443,
      path: '/api/v1/Tracking/Tracking',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    console.log('🔌 Connecting to Xpresion...');

    const request = https.request(options, (response) => {
      let data = '';

      response.on('data', (chunk) => {
        data += chunk;
      });

      response.on('end', () => {
        try {
          console.log(`📥 Xpresion Response Status: ${response.statusCode}`);
          
          // Try to parse JSON
          let parsedData;
          try {
            parsedData = JSON.parse(data);
          } catch (e) {
            // If not JSON, return raw data
            console.log('⚠️ Xpresion response is not JSON, returning raw:', data);
            parsedData = { raw: data };
          }

          console.log('📥 Xpresion Response:', JSON.stringify(parsedData).substring(0, 200));
          
          // Success if status is 200 or 201
          if (response.statusCode === 200 || response.statusCode === 201) {
            console.log('✅ Xpresion tracking data received successfully');
            res.json({
              success: true,
              data: parsedData
            });
          } else {
            console.error('❌ Xpresion returned error status:', response.statusCode);
            res.status(response.statusCode).json({
              success: false,
              error: parsedData.Message || parsedData.error || `Xpresion error: ${response.statusCode}`
            });
          }
        } catch (error) {
          console.error('❌ Error parsing Xpresion response:', error.message);
          res.status(500).json({ 
            success: false, 
            error: 'Failed to parse Xpresion response: ' + error.message 
          });
        }
      });
    });

    request.on('error', (error) => {
      console.error('❌ Xpresion Connection Error:', error.message);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to connect to Xpresion API: ' + error.message 
      });
    });

    request.on('timeout', () => {
      console.error('❌ Xpresion Request Timeout');
      request.destroy();
      res.status(500).json({ 
        success: false, 
        error: 'Xpresion API request timeout' 
      });
    });

    request.setTimeout(10000); // 10 second timeout
    request.write(postData);
    request.end();

  } catch (error) {
    console.error('❌ Tracking endpoint error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error: ' + error.message 
    });
  }
});

// ============ GET ANALYTICS ============
app.get('/api/analytics/dashboard', async (req, res) => {
  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select('*');
    
    if (error) throw error;
    
    const analytics = {
      total_orders: orders.length,
      total_revenue: orders.reduce((sum, o) => sum + (o.order_amount || 0), 0),
      paid_orders: orders.filter(o => o.payment_status === 'paid').length,
      cod_orders: orders.filter(o => o.payment_method === 'cash').length,
      orders_by_status: {
        pending: orders.filter(o => o.order_status === 'pending').length,
        confirmed: orders.filter(o => o.order_status === 'confirmed').length,
        shipped: orders.filter(o => o.order_status === 'shipped').length,
        delivered: orders.filter(o => o.order_status === 'delivered').length
      },
      average_order_value: orders.reduce((sum, o) => sum + (o.order_amount || 0), 0) / (orders.length || 1)
    };
    
    res.json(analytics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ EPS Backend running on port ${PORT}`);
});
