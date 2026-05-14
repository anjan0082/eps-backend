const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'your-key';
const supabase = createClient(supabaseUrl, supabaseKey);

// Create order
app.post('/api/orders', async (req, res) => {
  try {
    const orderData = req.body;

    // Get the count of existing orders to generate next invoice number
    const { count, error: countError } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true });

    if (countError) throw countError;

    // Generate next invoice number (count + 1)
    const nextInvoiceNumber = (count || 0) + 1;
    orderData.invoice_number = 'EPS' + String(nextInvoiceNumber).padStart(6, '0');

    const { data, error } = await supabase.from('orders').insert([orderData]);

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    console.error('Error:', err);
    res.status(400).json({ error: err.message });
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
    console.error('Error:', err);
    res.status(400).json({ error: err.message });
  }
});

// Update order
app.patch('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from('orders').update(req.body).eq('id', id);
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    console.error('Error:', err);
    res.status(400).json({ error: err.message });
  }
});

// Delete order
app.delete('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from('orders').delete().eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Error:', err);
    res.status(400).json({ error: err.message });
  }
});

// Analytics
app.get('/api/analytics/dashboard', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('order_amount');

    if (error) throw error;

    const total_orders = data.length;
    const total_revenue = data.reduce((sum, order) => sum + (order.order_amount || 0), 0);

    res.json({ total_orders, total_revenue });
  } catch (err) {
    console.error('Error:', err);
    res.status(400).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
