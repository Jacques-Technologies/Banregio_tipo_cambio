// ===== PROBLEMA IDENTIFICADO =====
// Error: El puerto está hardcodeado o hay conflicto

// ===== SOLUCIÓN 1: VERIFICAR index.js =====
// Tu index.js DEBE tener esto (NO un puerto fijo):

const express = require('express');
const { simularConvertToMXNConBrowser } = require('./simulador');

const app = express();

// ✅ CORRECTO: Puerto dinámico (Render asigna automáticamente)
const PORT = process.env.PORT || 3000;

// ❌ INCORRECTO: Puerto fijo
// const PORT = 10000; // ¡NO hagas esto en Render!

app.get('/api/simular/:tipoOperacion/:moneda/:cantidad', async (req, res) => {
  const { tipoOperacion, moneda, cantidad } = req.params;

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
    const resultado = await simularConvertToMXNConBrowser(moneda, num, tipoOperacion);
    res.json(resultado);
  } catch (error) {
    console.error('Error en endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/', (req, res) => {
  res.send('API de Simulación de Banregio - usa /api/simular/:tipoOperacion/:moneda/:cantidad');
});

// ===== MANEJO MEJORADO DE ERRORES =====
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API corriendo en puerto ${PORT}`);
  console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Puerto ${PORT} ya está en uso`);
    console.error('💡 Soluciones:');
    console.error('   1. Render debería asignar puerto automáticamente');
    console.error('   2. Verifica que no uses puerto fijo');
    console.error('   3. Reinicia el servicio en Render');
    process.exit(1);
  } else {
    console.error('❌ Error iniciando servidor:', err);
    process.exit(1);
  }
});

// ===== GRACEFUL SHUTDOWN =====
process.on('SIGTERM', () => {
  console.log('🔄 Cerrando servidor gracefully...');
  server.close(() => {
    console.log('✅ Servidor cerrado');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🔄 Interrupción detectada, cerrando...');
  server.close(() => {
    console.log('✅ Servidor cerrado');
    process.exit(0);
  });
});

// ===== SOLUCIÓN 2: VERIFICAR render.yaml =====
// Tu render.yaml NO debe especificar puerto fijo:

/* CORRECTO render.yaml:
services:
  - type: web
    name: currency-converter-api
    env: node
    region: oregon
    plan: starter
    buildCommand: |
      echo "🔧 Instalando dependencias..."
      npm ci
      echo "🔧 Instalando Chrome para Puppeteer..."
      npx puppeteer browsers install chrome
    startCommand: npm start
    healthCheckPath: /
    envVars:
      - key: NODE_ENV
        value: production
      - key: PUPPETEER_SKIP_CHROMIUM_DOWNLOAD
        value: "true"
      - key: PUPPETEER_CACHE_DIR
        value: "/opt/render/.cache/puppeteer"
      - key: PUPPETEER_EXECUTABLE_PATH
        value: "/opt/render/.cache/puppeteer/chrome/linux-*/chrome-linux*/chrome"
    disk:
      name: puppeteer-cache
      mountPath: /opt/render/.cache/puppeteer
      sizeGB: 2
*/

// ===== SOLUCIÓN 3: VERIFICAR package.json =====
/* Tu package.json debe tener:
{
  "name": "banregio-api",
  "version": "1.0.0",
  "scripts": {
    "start": "node index.js",
    "dev": "node index.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "puppeteer-core": "^21.0.0",
    "@sparticuz/chromium": "^118.0.0"
  }
}
*/

// ===== DEBUGGING: VERIFICAR CONFIGURACIÓN =====
console.log('🔍 DEBUGGING INFO:');
console.log('PORT env var:', process.env.PORT);
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('Platform:', process.platform);
console.log('Available ports:', 'Render asigna automáticamente');

// ===== SOLUCIÓN DE EMERGENCIA =====
// Si nada funciona, usa este código temporal:

const findAvailablePort = require('net').createServer();
findAvailablePort.listen(0, () => {
  const availablePort = findAvailablePort.address().port;
  findAvailablePort.close();
  
  if (!process.env.PORT) {
    console.log(`🔧 Puerto no asignado, usando disponible: ${availablePort}`);
    process.env.PORT = availablePort;
  }
});

module.exports = app;
