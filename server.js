const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use(cors());
app.use(express.json());

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

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

// ============ GET ORDER BY ID ============
app.get('/api/orders/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', req.params.id)
      .single();
    
    if (error) throw error;
    res.json(data);
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
app.post('/api/razorpay/create-order', async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt } = req.body;

    // Create Razorpay order
    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
    
    const response = await axios.post(
      'https://api.razorpay.com/v1/orders',
      {
        amount: Math.round(amount * 100), // Convert to paise
        currency,
        receipt,
        payment_capture: 1 // Auto-capture
      },
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Razorpay error:', error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ VERIFY RAZORPAY PAYMENT ============
app.post('/api/razorpay/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, order_id } = req.body;

    // Update order payment status
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

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ UPDATE ORDER STATUS ============
app.patch('/api/orders/:id/status', async (req, res) => {
  try {
    const { new_status, reason } = req.body;
    
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
