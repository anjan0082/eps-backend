const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============ MIDDLEWARE ============

app.use(cors());
app.use(express.json());

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Email transporter
const emailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// ============ AUTH MIDDLEWARE ============

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'Access token required' });
  
  jwt.verify(token, JWT_SECRET, (err, employee) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.employee = employee;
    next();
  });
};

// ============ AUTHENTICATION ENDPOINTS ============

// Employee Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { employee_id, password } = req.body;
    
    const { data: employee, error } = await supabase
      .from('employees')
      .select('*')
      .eq('id', employee_id)
      .single();
    
    if (error || !employee) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // In production, use bcrypt for password hashing
    if (employee.password_hash !== crypto.createHash('sha256').update(password).digest('hex')) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ id: employee.id, name: employee.name, role: employee.role }, JWT_SECRET);
    res.json({ token, employee });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Register Employee
app.post('/api/auth/register', async (req, res) => {
  try {
    const { id, name, email, phone, password, role } = req.body;
    const password_hash = crypto.createHash('sha256').update(password).digest('hex');
    
    const { data, error } = await supabase
      .from('employees')
      .insert([{ id, name, email, phone, password_hash, role, active: true }])
      .select()
      .single();
    
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ORDERS ENDPOINTS ============

// GET all orders with filters
app.get('/api/orders', authenticateToken, async (req, res) => {
  try {
    const { status, service_type, sort_by } = req.query;
    
    let query = supabase.from('orders').select('*');
    
    if (status) query = query.eq('order_status', status);
    if (service_type) query = query.eq('service_type', service_type);
    
    const { data, error } = await query.order(sort_by || 'created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET order by ID
app.get('/api/orders/:id', authenticateToken, async (req, res) => {
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

// CREATE new order
app.post('/api/orders', authenticateToken, async (req, res) => {
  try {
    const orderData = { ...req.body, employee_id: req.employee.id };
    
    const { data, error } = await supabase
      .from('orders')
      .insert([orderData])
      .select()
      .single();
    
    if (error) throw error;
    
    // Send email notification
    await sendOrderNotification(data, 'created');
    
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// UPDATE order status
app.patch('/api/orders/:id/status', authenticateToken, async (req, res) => {
  try {
    const { new_status, reason } = req.body;
    
    // Get current order
    const { data: order, error: getError } = await supabase
      .from('orders')
      .select('order_status, customer_email')
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
        changed_by: req.employee.id,
        reason: reason
      }]);
    
    // Send status update notification
    await sendStatusNotification(order.customer_email, data, new_status);
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// BULK create orders
app.post('/api/orders/bulk', authenticateToken, async (req, res) => {
  try {
    const { orders } = req.body;
    const ordersWithEmployee = orders.map(o => ({ ...o, employee_id: req.employee.id }));
    
    const { data, error } = await supabase
      .from('orders')
      .insert(ordersWithEmployee)
      .select();
    
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ANALYTICS ENDPOINTS ============

// GET analytics dashboard
app.get('/api/analytics/dashboard', authenticateToken, async (req, res) => {
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
      orders_by_service: groupByField(orders, 'service_type'),
      recent_orders: orders.slice(0, 10)
    };
    
    res.json(analytics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET revenue by date range
app.get('/api/analytics/revenue', authenticateToken, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    let query = supabase.from('orders').select('*');
    if (start_date) query = query.gte('created_at', start_date);
    if (end_date) query = query.lte('created_at', end_date);
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    const revenue = {
      total_revenue: data.reduce((sum, o) => sum + (o.order_amount || 0), 0),
      paid_revenue: data.filter(o => o.payment_status === 'paid').reduce((sum, o) => sum + (o.order_amount || 0), 0),
      cod_revenue: data.filter(o => o.payment_method === 'cash').reduce((sum, o) => sum + (o.order_amount || 0), 0),
      orders_count: data.length
    };
    
    res.json(revenue);
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
    
    const generated_signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');
    
    if (generated_signature === razorpay_signature) {
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

// ============ NOTIFICATION ENDPOINTS ============

// Send email notification
async function sendOrderNotification(order, action) {
  try {
    const subject = `Order ${action.toUpperCase()} - EPS Worldwide (${order.eps_reference_code})`;
    const html = `
      <h2>Order ${action.toUpperCase()}</h2>
      <p><strong>EPS Reference Code:</strong> ${order.eps_reference_code}</p>
      <p><strong>Customer:</strong> ${order.customer_name}</p>
      <p><strong>Amount:</strong> ₹${order.order_amount}</p>
      <p><strong>Service:</strong> ${order.service_type}</p>
      <p>Thank you for using EPS Worldwide!</p>
    `;
    
    await emailTransporter.sendMail({
      from: process.env.EMAIL_USER,
      to: order.customer_email,
      subject,
      html
    });
  } catch (error) {
    console.error('Email notification error:', error);
  }
}

// Send status update notification
async function sendStatusNotification(customerEmail, order, newStatus) {
  try {
    const statusMessages = {
      confirmed: 'Your order has been confirmed',
      shipped: 'Your order has been shipped',
      delivered: 'Your order has been delivered',
      pending: 'Your order is being processed'
    };
    
    const subject = `Order Update - ${statusMessages[newStatus] || 'Status Changed'} (${order.eps_reference_code})`;
    const html = `
      <h2>Order Status Update</h2>
      <p><strong>Status:</strong> ${newStatus.toUpperCase()}</p>
      <p><strong>EPS Reference Code:</strong> ${order.eps_reference_code}</p>
      <p>Track your order with this code.</p>
    `;
    
    await emailTransporter.sendMail({
      from: process.env.EMAIL_USER,
      to: customerEmail,
      subject,
      html
    });
  } catch (error) {
    console.error('Status notification error:', error);
  }
}

// ============ XPRESION INTEGRATION ============

// Generate AWB (integrates with Xpresion)
app.post('/api/xpresion/generate-awb', authenticateToken, async (req, res) => {
  try {
    const { order_id } = req.body;
    
    // Xpresion API call (replace with actual endpoint)
    const xpresionResponse = await axios.post(
      process.env.XPRESION_API_URL + '/shipment/create',
      {
        order_id: order_id,
        api_key: process.env.XPRESION_API_KEY
      }
    );
    
    const awb_number = xpresionResponse.data.awb_number;
    
    // Update order with AWB
    const { data, error } = await supabase
      .from('orders')
      .update({ awb_number })
      .eq('id', order_id)
      .select()
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Xpresion webhook (for status updates)
app.post('/api/xpresion/webhook', async (req, res) => {
  try {
    const { awb_number, status } = req.body;
    
    // Find order by AWB
    const { data: order, error: findError } = await supabase
      .from('orders')
      .select('id')
      .eq('awb_number', awb_number)
      .single();
    
    if (findError) throw findError;
    
    // Update order status
    await supabase
      .from('orders')
      .update({ order_status: mapXpresionStatus(status) })
      .eq('id', order.id);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ADMIN ENDPOINTS ============

// GET all employees
app.get('/api/admin/employees', authenticateToken, async (req, res) => {
  try {
    if (req.employee.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    
    const { data, error } = await supabase.from('employees').select('*');
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CREATE employee (admin only)
app.post('/api/admin/employees', authenticateToken, async (req, res) => {
  try {
    if (req.employee.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    
    const { data, error } = await supabase
      .from('employees')
      .insert([req.body])
      .select()
      .single();
    
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// UPDATE employee status
app.patch('/api/admin/employees/:id', authenticateToken, async (req, res) => {
  try {
    if (req.employee.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    
    const { data, error } = await supabase
      .from('employees')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ REPORTING ENDPOINTS ============

// Generate PDF report
app.get('/api/reports/orders', authenticateToken, async (req, res) => {
  try {
    const { start_date, end_date, format } = req.query;
    
    let query = supabase.from('orders').select('*');
    if (start_date) query = query.gte('created_at', start_date);
    if (end_date) query = query.lte('created_at', end_date);
    
    const { data, error } = await query;
    if (error) throw error;
    
    // Format as JSON or CSV
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.send(convertToCSV(data));
    } else {
      res.json(data);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ HEALTH CHECK ============

app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'EPS Backend v2 is running' });
});

// ============ HELPER FUNCTIONS ============

function groupByField(arr, field) {
  return arr.reduce((acc, item) => {
    acc[item[field]] = (acc[item[field]] || 0) + 1;
    return acc;
  }, {});
}

function mapXpresionStatus(xpresionStatus) {
  const mapping = {
    'in_transit': 'shipped',
    'out_for_delivery': 'shipped',
    'delivered': 'delivered',
    'pending': 'pending'
  };
  return mapping[xpresionStatus] || 'pending';
}

function convertToCSV(data) {
  if (!data || data.length === 0) return '';
  
  const headers = Object.keys(data[0]);
  const csv = [
    headers.join(','),
    ...data.map(row => headers.map(h => JSON.stringify(row[h])).join(','))
  ];
  
  return csv.join('\n');
}

// ============ START SERVER ============

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ EPS Backend v2 running on port ${PORT}`);
});
