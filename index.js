module.exports = (req, res) => {
  res.json({ 
    status: 'OK',
    service: 'EPS Worldwide Backend',
    message: 'Use /api/health or /api/track-* endpoints'
  });
};
