const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const Razorpay = require('razorpay');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'your-key';
const supabase = createClient(supabaseUrl, supabaseKey);

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_live_ShG1B8BUg7cDW2',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'E1RPyDteeoRxzjCIlL86H5P3',
});

// Create order
app.post('/api/orders', async (req, res) => {
  try {
    const {
      employee_id,
      customer_name,
      customer_email,
      customer_phone,
      receiver_name,
      receiver_phone,
      pickup_address,
      pickup_pincode,
      delivery_address,
      delivery_pincode,
      origin,
      destination,
      service_type,
      shipping_method,
      package_weight,
      package_length,
      package_width,
      package_height,
      order_amount,
      payment_method,
      payment_id,
      order_status,
      payment_status,
      eps_reference_code,
      customer_gst_no,
      customer_business_address,
      created_at,
    } = req.body;

    const { data, error } = await supabase.from('orders').insert([
      {
        employee_id,
        customer_name,
        customer_email,
        customer_phone,
        receiver_name,
        receiver_phone,
        pickup_address,
        pickup_pincode,
        delivery_address,
        delivery_pincode,
        origin,
        destination,
        service_type,
        shipping_method,
        package_weight,
        package_length,
        package_width,
        package_height,
        order_amount,
        payment_method,
        payment_id: payment_id || null,
        order_status,
        payment_status,
        eps_reference_code,
        customer_gst_no,
        customer_business_address,
        created_at: created_at || new Date().toISOString(),
      },
    ]);

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    console.error('Error creating order:', err);
    res.status(400).json({ error: err.message, details: err });
  }
});

// Get all orders
app.get('/api/orders', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(400).json({ error: err.message });
  }
});

// Update order
app.patch('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const { data, error } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    console.error('Error updating order:', err);
    res.status(400).json({ error: err.message });
  }
});

// Delete order
app.delete('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('orders')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting order:', err);
    res.status(400).json({ error: err.message });
  }
});

// Verify Razorpay payment
app.post('/api/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'E1RPyDteeoRxzjCIlL86H5P3')
      .update(body)
      .digest('hex');

    if (expectedSignature === razorpay_signature) {
      res.json({ success: true });
    } else {
      res.status(400).json({ success: false });
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Analytics dashboard
app.get('/api/analytics/dashboard', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('order_amount, order_status');

    if (error) throw error;

    const total_orders = data.length;
    const total_revenue = data.reduce((sum, order) => sum + (order.order_amount || 0), 0);

    res.json({ total_orders, total_revenue });
  } catch (err) {
    console.error('Error fetching analytics:', err);
    res.status(400).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
