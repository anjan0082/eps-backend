const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
require('dotenv').config();

const app = express();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use(cors());
app.use(express.json());

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

// ============ UPDATE ORDER PAYMENT STATUS ============
app.post('/api/orders/payment/confirm', async (req, res) => {
  try {
    const { orderId, razorpayPaymentId } = req.body;

    const { data, error } = await supabase
      .from('orders')
      .update({ 
        payment_status: 'paid',
        order_status: 'confirmed',
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId)
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
