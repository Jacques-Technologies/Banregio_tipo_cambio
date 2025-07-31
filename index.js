// ===== PROBLEMA IDENTIFICADO =====
// La línea con el error probablemente es:
// value: "/opt/render/.cache/puppeteer/chrome/linux-*/chrome-linux*/chrome"
// JavaScript está interpretando * como regex

// ===== SOLUCIÓN: index.js LIMPIO (sin código problemático) =====

const express = require('express');
const { simularConvertToMXNConBrowser } = require('./simulador');

const app = express();

// ✅ PUERTO DINÁMICO
const PORT = process.env.PORT || 3000;

// Trust proxy para IPs reales
app.set('trust proxy', true);

// ===== ENDPOINTS PRINCIPALES =====

app.get('/api/simular/:tipoOperacion/:moneda/:cantidad', async (req, res) => {
  const { tipoOperacion, moneda, cantidad } = req.params;

  // Validaciones
  if (!['compra', 'venta'].includes(tipoOperacion)) {
    return res.status(400).json({ error: 'tipoOperacion debe ser compra o venta' });
  }

  if (!['USD', 'EUR'].includes(moneda)) {
    return res.status(400).json({ error: 'moneda debe ser USD o EUR' });
  }

  const num = parseFloat(cantidad);
  if (isNaN(num) || num <= 0) {
    return res.status(400).json({ error: 'cantidad debe ser un número positivo' });
  }

  try {
    console.log(`📊 Procesando: ${tipoOperacion} ${cantidad} ${moneda}`);
    const resultado = await simularConvertToMXNConBrowser(moneda, num, tipoOperacion);
    res.json(resultado);
  } catch (error) {
    console.error('❌ Error en endpoint:', error.message);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/', (req, res) => {
  res.json({
    message: 'API de Simulación de Banregio',
    endpoints: {
      simular: '/api/simular/:tipoOperacion/:moneda/:cantidad'
    },
    ejemplo: '/api/simular/compra/USD/100',
    version: '1.0.0',
    status: 'running'
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    port: PORT
  });
});

// ===== SERVIDOR CON MANEJO DE ERRORES =====
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API corriendo en puerto ${PORT}`);
  console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
}).on('error', (err) => {
  console.error('❌ Error iniciando servidor:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🔄 Cerrando servidor...');
  server.close(() => {
    console.log('✅ Servidor cerrado');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🔄 Interrupción detectada...');
  server.close(() => {
    console.log('✅ Servidor cerrado');
    process.exit(0);
  });
});

module.exports = app;
