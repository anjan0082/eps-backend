const nodemailer = require('nodemailer');
const axios = require('axios');

// ============ EMAIL SERVICE ============

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      service: process.env.SMTP_HOST || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });
  }

  async sendOrderConfirmation(customer, order) {
    try {
      const html = this.getOrderConfirmationTemplate(customer, order);
      
      await this.transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: customer.email,
        subject: `Order Confirmed - EPS Worldwide (${order.eps_reference_code})`,
        html
      });
      
      return { success: true, message: 'Confirmation email sent' };
    } catch (error) {
      console.error('Email error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendStatusUpdate(customer, order, newStatus) {
    try {
      const html = this.getStatusUpdateTemplate(customer, order, newStatus);
      
      await this.transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: customer.email,
        subject: `Order Status Update - ${newStatus.toUpperCase()} (${order.eps_reference_code})`,
        html
      });
      
      return { success: true };
    } catch (error) {
      console.error('Email error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendInvoice(customer, invoice, pdfPath) {
    try {
      const html = this.getInvoiceTemplate(customer, invoice);
      
      await this.transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: customer.email,
        subject: `Invoice - ${invoice.invoice_number}`,
        html,
        attachments: [
          {
            filename: `invoice-${invoice.invoice_number}.pdf`,
            path: pdfPath
          }
        ]
      });
      
      return { success: true };
    } catch (error) {
      console.error('Email error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendPassword ResetLink(email, resetToken) {
    try {
      const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
      
      const html = `
        <h2>Password Reset Request</h2>
        <p>Click the link below to reset your password:</p>
        <p><a href="${resetUrl}">Reset Password</a></p>
        <p>This link expires in 1 hour.</p>
      `;
      
      await this.transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Password Reset - EPS Worldwide',
        html
      });
      
      return { success: true };
    } catch (error) {
      console.error('Email error:', error);
      return { success: false, error: error.message };
    }
  }

  getOrderConfirmationTemplate(customer, order) {
    return `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2>Order Confirmed!</h2>
        <p>Dear ${customer.name},</p>
        <p>Your order has been successfully confirmed.</p>
        
        <div style="background: #f5f5f5; padding: 20px; margin: 20px 0;">
          <h3>Order Details</h3>
          <p><strong>Reference Code:</strong> ${order.eps_reference_code}</p>
          <p><strong>Amount:</strong> ₹${order.order_amount}</p>
          <p><strong>Service Type:</strong> ${order.service_type}</p>
          <p><strong>From:</strong> ${order.pickup_address}</p>
          <p><strong>To:</strong> ${order.delivery_address}</p>
        </div>
        
        <p>Track your order using the reference code above.</p>
        <p>Thank you for choosing EPS Worldwide!</p>
      </div>
    `;
  }

  getStatusUpdateTemplate(customer, order, newStatus) {
    const statusMessages = {
      confirmed: 'Your order has been confirmed and is being prepared',
      shipped: 'Your order has been shipped and is on the way',
      delivered: 'Your order has been delivered',
      pending: 'Your order is being processed'
    };
    
    return `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2>Order Status Update</h2>
        <p>Dear ${customer.name},</p>
        <p>${statusMessages[newStatus] || 'Your order status has been updated'}.</p>
        
        <div style="background: #f5f5f5; padding: 20px; margin: 20px 0;">
          <p><strong>Reference Code:</strong> ${order.eps_reference_code}</p>
          <p><strong>Current Status:</strong> ${newStatus.toUpperCase()}</p>
          <p><strong>Updated At:</strong> ${new Date().toLocaleString()}</p>
        </div>
        
        <p>For tracking details, visit our website with your reference code.</p>
      </div>
    `;
  }

  getInvoiceTemplate(customer, invoice) {
    return `
      <div style="font-family: Arial, sans-serif;">
        <h2>Invoice</h2>
        <p>Dear ${customer.name},</p>
        
        <div style="background: #f5f5f5; padding: 20px; margin: 20px 0;">
          <p><strong>Invoice Number:</strong> ${invoice.invoice_number}</p>
          <p><strong>Amount:</strong> ₹${invoice.amount}</p>
          <p><strong>Tax:</strong> ₹${invoice.tax}</p>
          <p><strong>Total:</strong> ₹${invoice.total}</p>
          <p><strong>Date:</strong> ${new Date(invoice.issue_date).toLocaleDateString()}</p>
        </div>
        
        <p>Please find the attached PDF invoice.</p>
      </div>
    `;
  }
}

// ============ SMS SERVICE ============

class SMSService {
  constructor() {
    // Using Twilio or alternative SMS service
    this.apiUrl = 'https://api.twilio.com';
    this.accountSid = process.env.TWILIO_ACCOUNT_SID;
    this.authToken = process.env.TWILIO_AUTH_TOKEN;
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER;
  }

  async sendOrderNotification(phone, order) {
    try {
      const message = `Your order ${order.eps_reference_code} has been confirmed. Amount: ₹${order.order_amount}. Track at: ${process.env.MAIN_WEBSITE_URL}`;
      
      return await this.sendSMS(phone, message);
    } catch (error) {
      console.error('SMS error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendStatusUpdate(phone, epsRefCode, status) {
    try {
      const statusMessages = {
        confirmed: 'confirmed',
        shipped: 'shipped and on the way',
        delivered: 'delivered successfully'
      };
      
      const message = `Your order ${epsRefCode} has been ${statusMessages[status] || status}. Track at: ${process.env.MAIN_WEBSITE_URL}`;
      
      return await this.sendSMS(phone, message);
    } catch (error) {
      console.error('SMS error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendSMS(phone, message) {
    try {
      // Implementation depends on SMS provider (Twilio, AWS SNS, etc.)
      // This is a placeholder
      console.log(`SMS to ${phone}: ${message}`);
      return { success: true, message: 'SMS sent' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// ============ WEBHOOK SERVICE ============

class WebhookService {
  async sendWebhook(event, data) {
    try {
      const webhookUrl = process.env.WEBHOOK_URL;
      if (!webhookUrl) return { success: false, error: 'Webhook URL not configured' };
      
      const signature = this.generateSignature(JSON.stringify(data));
      
      const response = await axios.post(webhookUrl, {
        event,
        data,
        timestamp: new Date().toISOString()
      }, {
        headers: {
          'X-Webhook-Signature': signature,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
      
      return { success: true, statusCode: response.status };
    } catch (error) {
      console.error('Webhook error:', error);
      return { success: false, error: error.message };
    }
  }

  generateSignature(payload) {
    const crypto = require('crypto');
    return crypto
      .createHmac('sha256', process.env.WEBHOOK_SECRET || 'secret')
      .update(payload)
      .digest('hex');
  }
}

// ============ NOTIFICATION MANAGER ============

class NotificationManager {
  constructor(supabase) {
    this.supabase = supabase;
    this.emailService = new EmailService();
    this.smsService = new SMSService();
    this.webhookService = new WebhookService();
  }

  async notifyOrderCreated(order, customer) {
    // Email
    if (customer.email) {
      await this.emailService.sendOrderConfirmation(customer, order);
    }
    
    // SMS
    if (customer.phone) {
      await this.smsService.sendOrderNotification(customer.phone, order);
    }
    
    // Webhook
    await this.webhookService.sendWebhook('order.created', { order, customer });
    
    // Log notification
    await this.logNotification('order.created', customer.email, 'Order confirmation sent');
  }

  async notifyStatusChange(order, customer, newStatus) {
    // Email
    if (customer.email) {
      await this.emailService.sendStatusUpdate(customer, order, newStatus);
    }
    
    // SMS
    if (customer.phone) {
      await this.smsService.sendStatusUpdate(customer.phone, order.eps_reference_code, newStatus);
    }
    
    // Webhook
    await this.webhookService.sendWebhook('order.status_changed', { order, newStatus });
    
    // Log notification
    await this.logNotification(`order.${newStatus}`, customer.email, `Status changed to ${newStatus}`);
  }

  async logNotification(type, recipient, message) {
    try {
      await this.supabase.from('notifications').insert([{
        type,
        subject: type,
        message,
        customer_email: recipient,
        status: 'sent'
      }]);
    } catch (error) {
      console.error('Notification log error:', error);
    }
  }
}

module.exports = {
  EmailService,
  SMSService,
  WebhookService,
  NotificationManager
};
