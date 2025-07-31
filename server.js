const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: { error: 'Demasiadas solicitudes' }
});

app.use('/api/', limiter);

// Headers para simular navegador real
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.8,en-US;q=0.5,en;q=0.3',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1'
};

// Función para obtener tipo de cambio de múltiples fuentes
async function obtenerTipoCambio(moneda = 'USD') {
  const fuentes = [
    {
      nombre: 'Banco de México',
      url: 'https://www.banxico.org.mx/tipcamb/tipCamIHAction.do',
      parser: parseBanxico
    },
    {
      nombre: 'DOF',
      url: 'https://www.dof.gob.mx/indicadores.php',
      parser: parseDOF
    }
  ];

  for (const fuente of fuentes) {
    try {
      console.log(`🔍 Intentando ${fuente.nombre}...`);
      const response = await axios.get(fuente.url, { 
        headers,
        timeout: 10000,
        maxRedirects: 5
      });
      
      const resultado = await fuente.parser(response.data, moneda);
      if (resultado) {
        console.log(`✅ Datos obtenidos de ${fuente.nombre}`);
        return resultado;
      }
    } catch (error) {
      console.log(`❌ Error en ${fuente.nombre}:`, error.message);
      continue;
    }
  }
  
  // Fallback a API gratuita
  return await obtenerTipoCambioAPI(moneda);
}

// Parser para Banxico
async function parseBanxico(html, moneda) {
  try {
    const $ = cheerio.load(html);
    
    // Buscar tabla de tipos de cambio
    let tipoCambio = null;
    
    $('table tr').each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 2) {
        const currency = $(cells[0]).text().trim();
        const rate = $(cells[1]).text().trim();
        
        if (currency.includes(moneda) || currency.includes('DOLAR')) {
          const valor = parseFloat(rate.replace(/[,$]/g, ''));
          if (!isNaN(valor) && valor > 0) {
            tipoCambio = valor;
          }
        }
      }
    });
    
    if (tipoCambio) {
      return {
        compra: tipoCambio - 0.05,
        venta: tipoCambio + 0.05,
        fuente: 'Banxico'
      };
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// Parser para DOF
async function parseDOF(html, moneda) {
  try {
    const $ = cheerio.load(html);
    
    let tipoCambio = null;
    
    // Buscar en diferentes selectores posibles
    $('td, .indicador, .valor').each((i, el) => {
      const text = $(el).text().trim();
      if (text.includes('Dólar') || text.includes('USD')) {
        const parent = $(el).parent();
        const nextSibling = $(el).next();
        
        [parent, nextSibling, $(el)].forEach(element => {
          const valor = parseFloat(element.text().replace(/[,$]/g, ''));
          if (!isNaN(valor) && valor > 10 && valor < 30) {
            tipoCambio = valor;
          }
        });
      }
    });
    
    if (tipoCambio) {
      return {
        compra: tipoCambio - 0.1,
        venta: tipoCambio + 0.1,
        fuente: 'DOF'
      };
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// Fallback API gratuita
async function obtenerTipoCambioAPI(moneda) {
  try {
    // Usar API gratuita como ExchangeRate-API
    const response = await axios.get(`https://api.exchangerate-api.com/v4/latest/${moneda}`, {
      timeout: 5000
    });
    
    const mxnRate = response.data.rates.MXN;
    if (mxnRate) {
      return {
        compra: mxnRate - 0.1,
        venta: mxnRate + 0.1,
        fuente: 'ExchangeRate-API'
      };
    }
    
    throw new Error('No se encontró tasa MXN');
  } catch (error) {
    // Valores por defecto como último recurso
    const defaultRates = {
      USD: { compra: 17.8, venta: 18.2 },
      EUR: { compra: 19.5, venta: 19.9 },
      CAD: { compra: 13.2, venta: 13.6 },
      GBP: { compra: 22.8, venta: 23.2 }
    };
    
    return {
      ...defaultRates[moneda] || defaultRates.USD,
      fuente: 'Valores por defecto'
    };
  }
}

// Función principal de conversión
async function convertirDivisa({ tipo = 'comprar', moneda = 'USD', cantidad = 300 }) {
  try {
    const tasas = await obtenerTipoCambio(moneda);
    const tipoCambio = tipo === 'comprar' ? tasas.compra : tasas.venta;
    const mxn = cantidad * tipoCambio;
    
    return {
      mxn: parseFloat(mxn.toFixed(2)),
      tipoCambio: parseFloat(tipoCambio.toFixed(4)),
      tipo,
      moneda,
      cantidad,
      fuente: `cheerio-${tasas.fuente}`,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    throw new Error(`Error en conversión: ${error.message}`);
  }
}

// Rutas API
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'Currency Conversion API (Cheerio)',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/convert', async (req, res) => {
  try {
    const { tipo = 'comprar', moneda = 'USD', cantidad = 300 } = req.body;
    
    // Validaciones
    if (!['comprar', 'vender'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo debe ser "comprar" o "vender"' });
    }
    
    if (!['USD', 'EUR', 'CAD', 'GBP'].includes(moneda)) {
      return res.status(400).json({ error: 'Moneda no soportada' });
    }
    
    const cantidadNum = parseFloat(cantidad);
    if (isNaN(cantidadNum) || cantidadNum <= 0) {
      return res.status(400).json({ error: 'Cantidad debe ser un número positivo' });
    }
    
    const resultado = await convertirDivisa({ tipo, moneda, cantidad: cantidadNum });
    
    res.json({
      success: true,
      data: resultado
    });
    
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/convert/:tipo/:moneda/:cantidad', async (req, res) => {
  try {
    const { tipo, moneda, cantidad } = req.params;
    const resultado = await convertirDivisa({ 
      tipo, 
      moneda, 
      cantidad: parseFloat(cantidad) 
    });
    
    res.json({
      success: true,
      data: resultado
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/rates/:moneda?', async (req, res) => {
  try {
    const moneda = req.params.moneda || 'USD';
    const tasas = await obtenerTipoCambio(moneda);
    
    res.json({
      success: true,
      data: {
        moneda,
        compra: tasas.compra,
        venta: tasas.venta,
        fuente: tasas.fuente,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 API Cheerio iniciada en puerto ${PORT}`);
  console.log(`📋 Endpoints:`);
  console.log(`   POST /api/convert`);
  console.log(`   GET  /api/convert/:tipo/:moneda/:cantidad`);
  console.log(`   GET  /api/rates/:moneda`);
});

module.exports = app;
