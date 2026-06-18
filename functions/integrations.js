const axios = require('axios');
const PDFDocument = require('pdfkit');
const { stringify } = require('csv-stringify');
const fs = require('fs');

// ============ XPRESION INTEGRATION ============

class XpresionService {
  constructor() {
    this.apiUrl = process.env.XPRESION_API_URL;
    this.apiKey = process.env.XPRESION_API_KEY;
    this.accountId = process.env.XPRESION_ACCOUNT_ID;
  }

  async generateAWB(orderData) {
    try {
      const response = await axios.post(
        `${this.apiUrl}/shipment/create`,
        {
          account_id: this.accountId,
          order_reference: orderData.eps_reference_code,
          customer_name: orderData.customer_name,
          customer_phone: orderData.customer_phone,
          pickup_address: orderData.pickup_address,
          delivery_address: orderData.delivery_address,
          weight: orderData.package_weight,
          service_type: orderData.service_type
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      return {
        success: true,
        awb_number: response.data.awb_number,
        reference: response.data.reference
      };
    } catch (error) {
      console.error('Xpresion AWB generation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async trackShipment(awbNumber) {
    try {
      const response = await axios.get(
        `${this.apiUrl}/shipment/track/${awbNumber}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );
      
      return {
        success: true,
        status: response.data.status,
        location: response.data.location,
        lastUpdate: response.data.last_update
      };
    } catch (error) {
      console.error('Xpresion tracking error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  mapXpresionStatus(xpresionStatus) {
    const mapping = {
      'created': 'pending',
      'picked_up': 'confirmed',
      'in_transit': 'shipped',
      'out_for_delivery': 'shipped',
      'delivered': 'delivered',
      'failed': 'pending',
      'returned': 'pending'
    };
    return mapping[xpresionStatus] || 'pending';
  }
}

// ============ ANALYTICS SERVICE ============

class AnalyticsService {
  constructor(supabase) {
    this.supabase = supabase;
  }

  async getDashboardMetrics(startDate, endDate) {
    try {
      let query = this.supabase.from('orders').select('*');
      
      if (startDate) query = query.gte('created_at', startDate);
      if (endDate) query = query.lte('created_at', endDate);
      
      const { data: orders, error } = await query;
      
      if (error) throw error;
      
      return {
        total_orders: orders.length,
        total_revenue: orders.reduce((sum, o) => sum + (o.order_amount || 0), 0),
        paid_orders: orders.filter(o => o.payment_status === 'paid').length,
        pending_orders: orders.filter(o => o.order_status === 'pending').length,
        shipped_orders: orders.filter(o => o.order_status === 'shipped').length,
        delivered_orders: orders.filter(o => o.order_status === 'delivered').length,
        average_order_value: orders.reduce((sum, o) => sum + (o.order_amount || 0), 0) / (orders.length || 1),
        orders_by_service: this.groupBy(orders, 'service_type'),
        orders_by_status: this.groupBy(orders, 'order_status'),
        revenue_by_service: this.revenueByService(orders),
        daily_metrics: this.getDailyMetrics(orders)
      };
    } catch (error) {
      console.error('Analytics error:', error);
      throw error;
    }
  }

  async getEmployeeMetrics(employeeId, startDate, endDate) {
    try {
      let query = this.supabase
        .from('orders')
        .select('*')
        .eq('employee_id', employeeId);
      
      if (startDate) query = query.gte('created_at', startDate);
      if (endDate) query = query.lte('created_at', endDate);
      
      const { data: orders, error } = await query;
      
      if (error) throw error;
      
      return {
        total_orders_created: orders.length,
        total_revenue_generated: orders.reduce((sum, o) => sum + (o.order_amount || 0), 0),
        orders_by_status: this.groupBy(orders, 'order_status'),
        successful_deliveries: orders.filter(o => o.order_status === 'delivered').length,
        success_rate: (orders.filter(o => o.order_status === 'delivered').length / orders.length * 100).toFixed(2) + '%'
      };
    } catch (error) {
      console.error('Employee metrics error:', error);
      throw error;
    }
  }

  async saveAnalyticsSnapshot(metrics) {
    try {
      await this.supabase.from('analytics').insert([{
        date: new Date().toISOString().split('T')[0],
        total_orders: metrics.total_orders,
        total_revenue: metrics.total_revenue,
        paid_revenue: metrics.total_revenue * 0.7, // Assuming 70% paid
        cod_revenue: metrics.total_revenue * 0.3,
        delivered_count: metrics.delivered_orders,
        pending_count: metrics.pending_orders,
        shipped_count: metrics.shipped_orders,
        average_order_value: metrics.average_order_value
      }]);
    } catch (error) {
      console.error('Analytics snapshot error:', error);
    }
  }

  groupBy(arr, key) {
    return arr.reduce((acc, item) => {
      acc[item[key]] = (acc[item[key]] || 0) + 1;
      return acc;
    }, {});
  }

  revenueByService(orders) {
    return orders.reduce((acc, order) => {
      const service = order.service_type;
      acc[service] = (acc[service] || 0) + (order.order_amount || 0);
      return acc;
    }, {});
  }

  getDailyMetrics(orders) {
    const daily = {};
    orders.forEach(order => {
      const date = new Date(order.created_at).toISOString().split('T')[0];
      if (!daily[date]) {
        daily[date] = { orders: 0, revenue: 0 };
      }
      daily[date].orders += 1;
      daily[date].revenue += order.order_amount || 0;
    });
    return daily;
  }
}

// ============ REPORTING SERVICE ============

class ReportingService {
  constructor(supabase) {
    this.supabase = supabase;
  }

  async generatePDFReport(orders, reportType = 'summary') {
    try {
      const doc = new PDFDocument();
      const filename = `/tmp/report-${Date.now()}.pdf`;
      const stream = fs.createWriteStream(filename);
      
      doc.pipe(stream);
      
      // Header
      doc.fontSize(24).text('EPS Worldwide - Order Report', 100, 50);
      doc.fontSize(12).text(`Generated: ${new Date().toLocaleString()}`, 100, 100);
      doc.moveTo(100, 120).lineTo(500, 120).stroke();
      
      // Report content
      if (reportType === 'summary') {
        this.addSummaryReport(doc, orders);
      } else if (reportType === 'detailed') {
        this.addDetailedReport(doc, orders);
      }
      
      doc.end();
      
      return new Promise((resolve, reject) => {
        stream.on('finish', () => resolve(filename));
        stream.on('error', reject);
      });
    } catch (error) {
      console.error('PDF generation error:', error);
      throw error;
    }
  }

  async generateCSVReport(orders) {
    try {
      const filename = `/tmp/report-${Date.now()}.csv`;
      
      const output = fs.createWriteStream(filename);
      const columns = [
        'eps_reference_code',
        'customer_name',
        'customer_email',
        'service_type',
        'order_amount',
        'order_status',
        'payment_status',
        'created_at'
      ];
      
      const stringifier = stringify({ header: true, columns });
      
      stringifier.pipe(output);
      
      orders.forEach(order => {
        stringifier.write([
          order.eps_reference_code,
          order.customer_name,
          order.customer_email,
          order.service_type,
          order.order_amount,
          order.order_status,
          order.payment_status,
          order.created_at
        ]);
      });
      
      stringifier.end();
      
      return new Promise((resolve, reject) => {
        output.on('finish', () => resolve(filename));
        output.on('error', reject);
      });
    } catch (error) {
      console.error('CSV generation error:', error);
      throw error;
    }
  }

  addSummaryReport(doc, orders) {
    doc.fontSize(14).text('Order Summary', 100, 150);
    
    const metrics = {
      total: orders.length,
      revenue: orders.reduce((sum, o) => sum + (o.order_amount || 0), 0),
      delivered: orders.filter(o => o.order_status === 'delivered').length,
      pending: orders.filter(o => o.order_status === 'pending').length
    };
    
    doc.fontSize(12);
    doc.text(`Total Orders: ${metrics.total}`, 100, 200);
    doc.text(`Total Revenue: ₹${metrics.revenue.toFixed(2)}`, 100, 230);
    doc.text(`Delivered: ${metrics.delivered}`, 100, 260);
    doc.text(`Pending: ${metrics.pending}`, 100, 290);
  }

  addDetailedReport(doc, orders) {
    doc.fontSize(14).text('Detailed Order List', 100, 150);
    
    let y = 200;
    const pageHeight = doc.page.height;
    const lineHeight = 30;
    
    // Table header
    doc.fontSize(10);
    doc.text('Ref Code', 100, y);
    doc.text('Customer', 200, y);
    doc.text('Amount', 350, y);
    doc.text('Status', 420, y);
    
    y += lineHeight;
    
    // Table rows
    orders.slice(0, 15).forEach(order => {
      if (y > pageHeight - 50) {
        doc.addPage();
        y = 50;
      }
      
      doc.text(order.eps_reference_code, 100, y);
      doc.text(order.customer_name.substring(0, 20), 200, y);
      doc.text(`₹${order.order_amount}`, 350, y);
      doc.text(order.order_status, 420, y);
      
      y += lineHeight;
    });
  }
}

// ============ INVOICE SERVICE ============

class InvoiceService {
  constructor(supabase) {
    this.supabase = supabase;
  }

  async generateInvoice(order, customer) {
    try {
      const invoiceNumber = `INV-${Date.now()}`;
      const amount = order.order_amount;
      const tax = amount * 0.18; // 18% GST
      const total = amount + tax;
      
      const pdfPath = await this.generateInvoicePDF(invoiceNumber, customer, order, amount, tax, total);
      
      const { data, error } = await this.supabase
        .from('invoices')
        .insert([{
          id: `inv_${Date.now()}`,
          order_id: order.id,
          invoice_number: invoiceNumber,
          amount,
          tax,
          total,
          pdf_url: pdfPath,
          status: 'issued'
        }])
        .select()
        .single();
      
      if (error) throw error;
      
      return { success: true, invoice: data, pdfPath };
    } catch (error) {
      console.error('Invoice generation error:', error);
      return { success: false, error: error.message };
    }
  }

  async generateInvoicePDF(invoiceNumber, customer, order, amount, tax, total) {
    try {
      const doc = new PDFDocument();
      const filename = `/tmp/invoice-${invoiceNumber}.pdf`;
      const stream = fs.createWriteStream(filename);
      
      doc.pipe(stream);
      
      // Header
      doc.fontSize(20).text('INVOICE', 50, 50);
      doc.fontSize(10);
      doc.text(`Invoice Number: ${invoiceNumber}`, 50, 100);
      doc.text(`Date: ${new Date().toLocaleDateString()}`, 50, 120);
      
      // Company info
      doc.fontSize(12).text('EPS Worldwide', 50, 160);
      doc.fontSize(10);
      doc.text('info@epsworldwide.in', 50, 180);
      doc.text('+91 9820812318', 50, 200);
      
      // Customer info
      doc.text('Bill To:', 300, 160);
      doc.text(customer.name, 300, 180);
      doc.text(customer.email, 300, 200);
      doc.text(customer.phone, 300, 220);
      
      // Order details
      doc.moveTo(50, 250).lineTo(550, 250).stroke();
      doc.text('Description', 50, 270);
      doc.text('Amount', 450, 270);
      doc.text(order.service_type, 50, 300);
      doc.text(`₹${amount}`, 450, 300);
      
      // Totals
      doc.moveTo(50, 350).lineTo(550, 350).stroke();
      doc.text('Subtotal:', 350, 370);
      doc.text(`₹${amount}`, 450, 370);
      doc.text('GST (18%):', 350, 390);
      doc.text(`₹${tax.toFixed(2)}`, 450, 390);
      doc.fontSize(12).text('Total:', 350, 420);
      doc.text(`₹${total.toFixed(2)}`, 450, 420);
      
      doc.end();
      
      return new Promise((resolve, reject) => {
        stream.on('finish', () => resolve(filename));
        stream.on('error', reject);
      });
    } catch (error) {
      console.error('PDF generation error:', error);
      throw error;
    }
  }
}

module.exports = {
  XpresionService,
  AnalyticsService,
  ReportingService,
  InvoiceService
};
