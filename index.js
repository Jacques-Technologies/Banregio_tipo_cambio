const express = require('express');
const { simularConvertToMXNConBrowser } = require('./simulador');

const app = express();

// ✅ PUERTO DINÁMICO - RENDER ASIGNA AUTOMÁTICAMENTE
const PORT = process.env.PORT || 3000;

console.log(`🔧 Configurando servidor en puerto: ${PORT}`);
console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);

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
    endpoint: '/api/simular/:tipoOperacion/:moneda/:cantidad',
    ejemplo: '/api/simular/compra/USD/100',
    status: 'running',
    port: PORT
  });
});

// ✅ INICIAR SERVIDOR UNA SOLA VEZ
let serverStarted = false;

if (!serverStarted) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    serverStarted = true;
    console.log(`✅ Servidor iniciado exitosamente en puerto ${PORT}`);
    console.log(`🌐 URL base: http://0.0.0.0:${PORT}`);
  });

  server.on('error', (err) => {
    console.error('❌ Error del servidor:', err.message);
    
    if (err.code === 'EADDRINUSE') {
      console.error(`💥 Puerto ${PORT} ya está en uso`);
      console.error('🔧 Render debería manejar esto automáticamente');
      console.error('🔄 Si persiste, suspende y reactiva el servicio');
    }
    
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('🔄 SIGTERM recibido, cerrando servidor...');
    server.close(() => {
      console.log('✅ Servidor cerrado correctamente');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('🔄 SIGINT recibido, cerrando servidor...');
    server.close(() => {
      console.log('✅ Servidor cerrado correctamente');
      process.exit(0);
    });
  });
} else {
  console.log('⚠️ Servidor ya iniciado, evitando duplicado');
}
