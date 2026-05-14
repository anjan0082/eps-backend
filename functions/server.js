const { createClient } = require('@supabase/supabase-js');

// Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Helper to set CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  const path = event.path.replace('/.netlify/functions/server', '');
  const method = event.httpMethod;

  try {
    // Parse body
    let body = {};
    if (event.body) {
      body = JSON.parse(event.body);
    }

    // GET /api/orders
    if (method === 'GET' && path === '/api/orders') {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(data || [])
      };
    }

    // POST /api/orders
    if (method === 'POST' && path === '/api/orders') {
      const orderData = body;

      // Get count for invoice number
      const { count, error: countError } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true });

      if (countError) throw countError;

      // Generate invoice number
      const nextInvoiceNumber = (count || 0) + 1;
      orderData.invoice_number = 'EPS' + String(nextInvoiceNumber).padStart(6, '0');

      const { data, error } = await supabase.from('orders').insert([orderData]);

      if (error) throw error;
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true, data })
      };
    }

    // PATCH /api/orders/:id
    if (method === 'PATCH' && path.startsWith('/api/orders/')) {
      const id = path.split('/').pop();
      const { data, error } = await supabase.from('orders').update(body).eq('id', id);
      if (error) throw error;
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true, data })
      };
    }

    // DELETE /api/orders/:id
    if (method === 'DELETE' && path.startsWith('/api/orders/')) {
      const id = path.split('/').pop();
      const { data, error } = await supabase.from('orders').delete().eq('id', id);
      if (error) throw error;
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true })
      };
    }

    // GET /api/analytics/dashboard
    if (method === 'GET' && path === '/api/analytics/dashboard') {
      const { data, error } = await supabase.from('orders').select('order_amount');
      if (error) throw error;

      const total_orders = data.length;
      const total_revenue = data.reduce((sum, order) => sum + (order.order_amount || 0), 0);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ total_orders, total_revenue })
      };
    }

    // 404
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' })
    };
  } catch (err) {
    console.error('Error:', err);
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message })
    };
  }
};
