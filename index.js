const express = require('express');
const { simularConvertToMXNConBrowser } = require('./simulador');

const app = express();
const PORT = process.env.PORT || 3000;

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

  const resultado = await simularConvertToMXNConBrowser(moneda, num, tipoOperacion);
  res.json(resultado);
});

app.get('/', (req, res) => {
  res.send('API de Simulación de Banregio - usa /api/simular/:tipoOperacion/:moneda/:cantidad');
});

app.listen(PORT, () => {
  console.log(`🚀 API corriendo en puerto ${PORT}`);
});
