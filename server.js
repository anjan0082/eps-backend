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

// ============ HEALTH CHECK ============
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'EPS Backend v2 is running' });
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
    res.status(500).json({ error: error.message });
  }
});

// ============ CREATE ORDER ============
app.post('/api/orders', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .insert([req.body])
      .select()
      .single();
    
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ CREATE RAZORPAY ORDER ============
app.post('/api/razorpay/create-order', (req, res) => {
  const { amount, receipt, customer_email, customer_name } = req.body;

  const postData = JSON.stringify({
    amount: Math.round(amount * 100), // Convert to paise
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
      'Content-Length': postData.length
    }
  };

  const request = https.request(options, (response) => {
    let data = '';

    response.on('data', (chunk) => {
      data += chunk;
    });

    response.on('end', () => {
      try {
        const parsedData = JSON.parse(data);
        if (response.statusCode === 200) {
          res.json({
            success: true,
            razorpay_order_id: parsedData.id,
            amount: parsedData.amount,
            currency: parsedData.currency,
            status: parsedData.status
          });
        } else {
          res.status(response.statusCode).json({
            success: false,
            error: parsedData.description || 'Failed to create order'
          });
        }
      } catch (error) {
        res.status(500).json({ success: false, error: 'Invalid response from Razorpay' });
      }
    });
  });

  request.on('error', (error) => {
    console.error('Razorpay API Error:', error);
    res.status(500).json({ success: false, error: error.message });
  });

  request.write(postData);
  request.end();
});

// ============ VERIFY RAZORPAY PAYMENT ============
app.post('/api/razorpay/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, order_id } = req.body;

    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    const isValidSignature = expectedSignature === razorpay_signature;

    if (!isValidSignature) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid payment signature' 
      });
    }

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

    res.json({ 
      success: true, 
      message: 'Payment verified successfully',
      data 
    });
  } catch (error) {
    console.error('Verification Error:', error);
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
