// Backend API - v1.0 - PRODUCTION READY
// Backend API - Updated
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use(cors());
app.use(express.json());

// ============ ORDERS ENDPOINTS ============

// GET all orders
app.get('/api/orders', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET order by ID
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

// GET order by EPS Reference Code
app.get('/api/orders/ref/:epsRefCode', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('eps_reference_code', req.params.epsRefCode)
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET order by AWB Number
app.get('/api/orders/awb/:awb', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('awb_number', req.params.awb)
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CREATE new order
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
    res.status(500).json({ error: error.message });
  }
});

// UPDATE order status
app.patch('/api/orders/:id/status', async (req, res) => {
  try {
    const { new_status, reason, changed_by } = req.body;
    
    // Get current order
    const { data: order, error: getError } = await supabase
      .from('orders')
      .select('order_status')
      .eq('id', req.params.id)
      .single();
    
    if (getError) throw getError;
    
    // Update order status
    const { data, error: updateError } = await supabase
      .from('orders')
      .update({ 
        order_status: new_status,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .select()
      .single();
    
    if (updateError) throw updateError;
    
    // Log status change
    await supabase
      .from('status_history')
      .insert([{
        order_id: req.params.id,
        old_status: order.order_status,
        new_status: new_status,
        changed_by: changed_by,
        reason: reason
      }]);
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ PAYMENT ENDPOINTS ============

// CREATE Razorpay order
app.post('/api/payment/create-order', async (req, res) => {
  try {
    const { amount, order_id } = req.body;
    
    const response = await axios.post(
      'https://api.razorpay.com/v1/orders',
      {
        amount: Math.round(amount * 100),
        currency: 'INR',
        receipt: order_id
      },
      {
        auth: {
          username: process.env.RAZORPAY_KEY_ID,
          password: process.env.RAZORPAY_KEY_SECRET
        }
      }
    );
    
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// VERIFY Razorpay payment
app.post('/api/payment/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, order_id } = req.body;
    
    // Verify signature
    const generated_signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');
    
    if (generated_signature === razorpay_signature) {
      // Signature matches - save payment
      const { data, error } = await supabase
        .from('payments')
        .insert([{
          id: `pay_${Date.now()}`,
          order_id: order_id,
          razorpay_payment_id: razorpay_payment_id,
          razorpay_order_id: razorpay_order_id,
          amount: req.body.amount,
          status: 'completed',
          payment_method: 'razorpay'
        }])
        .select()
        .single();
      
      // Update order status
      await supabase
        .from('orders')
        .update({ payment_status: 'paid' })
        .eq('id', order_id);
      
      res.json({ success: true, data });
    } else {
      res.status(400).json({ error: 'Invalid signature' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ HEALTH CHECK ============

app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'EPS Backend is running' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});
