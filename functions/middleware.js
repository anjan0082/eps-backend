const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const helmet = require('helmet');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// ============ AUTHENTICATION MIDDLEWARE ============

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required', code: 'NO_TOKEN' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, employee) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(403).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(403).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
    }
    req.employee = employee;
    next();
  });
};

// ============ ROLE BASED ACCESS CONTROL ============

const authorizeRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.employee) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!allowedRoles.includes(req.employee.role)) {
      return res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    }
    
    next();
  };
};

// ============ REQUEST VALIDATION ============

const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false });
    
    if (error) {
      const errors = error.details.map(e => ({
        field: e.path.join('.'),
        message: e.message
      }));
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    
    req.validatedData = value;
    next();
  };
};

// ============ VALIDATION SCHEMAS ============

const schemas = {
  // Auth
  login: Joi.object({
    employee_id: Joi.string().required(),
    password: Joi.string().min(6).required()
  }),
  
  register: Joi.object({
    id: Joi.string().required(),
    name: Joi.string().required(),
    email: Joi.string().email().required(),
    phone: Joi.string().optional(),
    password: Joi.string().min(8).required(),
    role: Joi.string().valid('employee', 'manager', 'admin').default('employee')
  }),
  
  // Orders
  createOrder: Joi.object({
    customer_name: Joi.string().required(),
    customer_email: Joi.string().email().required(),
    customer_phone: Joi.string().required(),
    pickup_address: Joi.string().required(),
    delivery_address: Joi.string().required(),
    delivery_pincode: Joi.string().required(),
    service_type: Joi.string().required(),
    shipping_method: Joi.string().required(),
    package_weight: Joi.number().optional(),
    order_amount: Joi.number().required()
  }),
  
  updateOrderStatus: Joi.object({
    new_status: Joi.string().valid('pending', 'confirmed', 'shipped', 'delivered').required(),
    reason: Joi.string().optional()
  }),
  
  createPayment: Joi.object({
    amount: Joi.number().positive().required(),
    order_id: Joi.string().required(),
    payment_method: Joi.string().required()
  }),
  
  createEmployee: Joi.object({
    id: Joi.string().required(),
    name: Joi.string().required(),
    email: Joi.string().email().required(),
    phone: Joi.string().optional(),
    role: Joi.string().valid('employee', 'manager', 'admin').required(),
    department: Joi.string().optional()
  })
};

// ============ RATE LIMITING ============

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 login attempts per 15 minutes
  message: 'Too many login attempts, please try again later.',
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50, // 50 requests per minute
});

// ============ ERROR HANDLING MIDDLEWARE ============

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);
  
  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: 'Validation failed', details: err.details });
  }
  
  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(403).json({ error: 'Invalid token' });
  }
  
  // Database errors
  if (err.code === '23505') { // Unique violation
    return res.status(409).json({ error: 'Duplicate entry', code: 'DUPLICATE' });
  }
  
  if (err.code === '23503') { // Foreign key violation
    return res.status(400).json({ error: 'Invalid reference', code: 'INVALID_REFERENCE' });
  }
  
  // Default error
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    code: err.code || 'INTERNAL_ERROR'
  });
};

// ============ REQUEST LOGGING MIDDLEWARE ============

const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });
  
  next();
};

// ============ AUDIT LOGGING MIDDLEWARE ============

const auditLog = (supabase) => {
  return async (req, res, next) => {
    const originalSend = res.send;
    
    res.send = function(data) {
      // Only log state-changing operations
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
        auditLogEntry(supabase, req, res.statusCode).catch(console.error);
      }
      return originalSend.call(this, data);
    };
    
    next();
  };
};

async function auditLogEntry(supabase, req, statusCode) {
  try {
    if (!req.employee) return;
    
    await supabase.from('audit_log').insert([{
      employee_id: req.employee.id,
      action: `${req.method} ${req.path}`,
      entity_type: extractEntityType(req.path),
      ip_address: req.ip,
      changes: req.body
    }]);
  } catch (error) {
    console.error('Audit log error:', error);
  }
}

function extractEntityType(path) {
  const match = path.match(/\/api\/(\w+)/);
  return match ? match[1] : 'unknown';
}

// ============ CORS CONFIGURATION ============

const corsOptions = {
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3001',
    process.env.MAIN_WEBSITE_URL || 'http://localhost:3000',
    'http://localhost:3000',
    'http://localhost:3001'
  ],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// ============ SECURITY HEADERS ============

const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
});

module.exports = {
  authenticateToken,
  authorizeRole,
  validateRequest,
  schemas,
  limiter,
  authLimiter,
  apiLimiter,
  asyncHandler,
  errorHandler,
  requestLogger,
  auditLog,
  corsOptions,
  securityHeaders
};
