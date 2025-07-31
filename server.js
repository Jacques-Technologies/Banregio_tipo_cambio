const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

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
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0'
};

// Cache simple para evitar requests repetidos
const cache = new Map();
const CACHE_DURATION = 2 * 60 * 1000; // 2 minutos

function getCached(key) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// ✅ FUNCIÓN PARA SCRAPING DIRECTO DE BANREGIO
async function scrapeBanregio() {
  try {
    console.log('🔍 Haciendo scraping directo de Banregio...');
    
    // Realizar request con headers completos
    const response = await axios.get('https://www.banregio.com/divisas.php', {
      headers,
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500
    });
    
    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = response.data;
    const $ = cheerio.load(html);
    
    console.log('✅ HTML obtenido, analizando...');
    
    // Buscar datos de divisas en el HTML
    const divisasData = {};
    
    // Estrategia 1: Buscar en tablas
    $('table tr').each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 3) {
        const moneda = $(cells[0]).text().trim();
        const compra = $(cells[1]).text().trim();
        const venta = $(cells[2]).text().trim();
        
        if (moneda && compra && venta) {
          const compraNum = parseFloat(compra.replace(/[,$]/g, ''));
          const ventaNum = parseFloat(venta.replace(/[,$]/g, ''));
          
          if (!isNaN(compraNum) && !isNaN(ventaNum)) {
            divisasData[moneda.toUpperCase()] = {
              compra: compraNum,
              venta: ventaNum
            };
          }
        }
      }
    });
    
    // Estrategia 2: Buscar en divs con clases específicas
    $('.divisa, .currency, .tipo-cambio').each((i, el) => {
      const text = $(el).text();
      const monedaMatch = text.match(/(USD|EUR|CAD|GBP|JPY)/i);
      const precioMatch = text.match(/(\d+\.?\d*)/g);
      
      if (monedaMatch && precioMatch && precioMatch.length >= 2) {
        const moneda = monedaMatch[0].toUpperCase();
        const precios = precioMatch.map(p => parseFloat(p)).filter(p => p > 10 && p < 30);
        
        if (precios.length >= 2) {
          divisasData[moneda] = {
            compra: Math.min(...precios),
            venta: Math.max(...precios)
          };
        }
      }
    });
    
    // Estrategia 3: Buscar en scripts JSON embebidos
    $('script').each((i, script) => {
      const content = $(script).html();
      if (content && content.includes('divisa')) {
        try {
          // Buscar patrones JSON
          const jsonMatch = content.match(/\{[^}]*divisa[^}]*\}/gi);
          if (jsonMatch) {
            jsonMatch.forEach(json => {
              try {
                const data = JSON.parse(json);
                if (data.USD || data.EUR) {
                  Object.assign(divisasData, data);
                }
              } catch (e) {}
            });
          }
        } catch (e) {}
      }
    });
    
    // Estrategia 4: Buscar valores numéricos cerca de USD/EUR
    const fullText = $.text();
    const usdMatch = fullText.match(/USD[^\d]*(\d+\.?\d*)[^\d]*(\d+\.?\d*)/i);
    const eurMatch = fullText.match(/EUR[^\d]*(\d+\.?\d*)[^\d]*(\d+\.?\d*)/i);
    
    if (usdMatch) {
      const precio1 = parseFloat(usdMatch[1]);
      const precio2 = parseFloat(usdMatch[2]);
      if (precio1 > 10 && precio1 < 30 && precio2 > 10 && precio2 < 30) {
        divisasData.USD = {
          compra: Math.min(precio1, precio2),
          venta: Math.max(precio1, precio2)
        };
      }
    }
    
    if (eurMatch) {
      const precio1 = parseFloat(eurMatch[1]);
      const precio2 = parseFloat(eurMatch[2]);
      if (precio1 > 15 && precio1 < 35 && precio2 > 15 && precio2 < 35) {
        divisasData.EUR = {
          compra: Math.min(precio1, precio2),
          venta: Math.max(precio1, precio2)
        };
      }
    }
    
    console.log('📊 Datos extraídos:', divisasData);
    
    if (Object.keys(divisasData).length === 0) {
      throw new Error('No se encontraron datos de divisas en el HTML');
    }
    
    return divisasData;
    
  } catch (error) {
    console.error('❌ Error en scraping:', error.message);
    throw error;
  }
}

// ✅ FUNCIÓN FALLBACK CON VALORES APROXIMADOS DE BANREGIO
function getFallbackRates() {
  // Valores aproximados basados en rangos históricos de Banregio
  return {
    USD: { compra: 17.85, venta: 18.15 },
    EUR: { compra: 19.45, venta: 19.85 },
    CAD: { compra: 13.25, venta: 13.55 },
    GBP: { compra: 22.75, venta: 23.15 },
    JPY: { compra: 0.118, venta: 0.122 }
  };
}

// ✅ FUNCIÓN PRINCIPAL DE CONVERSIÓN
async function convertirDivisa({ tipo = 'comprar', moneda = 'USD', cantidad = 300 }) {
  try {
    console.log(`🔄 Convirtiendo con Cheerio: ${tipo} ${cantidad} ${moneda}`);
    
    const cacheKey = `banregio-rates`;
    let tasas = getCached(cacheKey);
    
    if (!tasas) {
      console.log('📡 Obteniendo tasas frescas de Banregio...');
      
      try {
        tasas = await scrapeBanregio();
        setCache(cacheKey, tasas);
        console.log('✅ Tasas obtenidas y guardadas en cache');
      } catch (scrapingError) {
        console.log('⚠️ Scraping falló, usando valores fallback:', scrapingError.message);
        tasas = getFallbackRates();
        setCache(cacheKey, tasas);
      }
    } else {
      console.log('✅ Usando tasas desde cache');
    }
    
    // Obtener tasa para la moneda solicitada
    const tasaMoneda = tasas[moneda];
    if (!tasaMoneda) {
      throw new Error(`No se encontró tasa para ${moneda}`);
    }
    
    const tipoCambio = tipo === 'comprar' ? tasaMoneda.compra : tasaMoneda.venta;
    const mxn = cantidad * tipoCambio;
    
    return {
      mxn: parseFloat(mxn.toFixed(2)),
      tipoCambio: parseFloat(tipoCambio.toFixed(4)),
      tipo,
      moneda,
      cantidad,
      fuente: 'banregio-cheerio',
      timestamp: new Date().toISOString(),
      detalles: {
        tasaCompra: tasaMoneda.compra,
        tasaVenta: tasaMoneda.venta,
        fuenteDatos: tasas === getFallbackRates() ? 'fallback' : 'scraping'
      }
    };
    
  } catch (error) {
    throw new Error(`Error en conversión: ${error.message}`);
  }
}

// ✅ FUNCIÓN CON RETRY
async function convertirDivisaConRetry(params, reintentos = 0) {
  try {
    return await convertirDivisa(params);
  } catch (error) {
    if (reintentos < 2) {
      console.log(`🔄 Reintento ${reintentos + 1}/3...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return await convertirDivisaConRetry(params, reintentos + 1);
    }
    throw error;
  }
}

// Validación
function validateParams(req, res, next) {
  const { tipo, moneda, cantidad } = req.body || req.params;
  
  if (tipo && !['comprar', 'vender'].includes(tipo)) {
    return res.status(400).json({ error: 'Tipo debe ser "comprar" o "vender"' });
  }
  
  if (moneda && !['USD', 'EUR', 'CAD', 'GBP', 'JPY'].includes(moneda)) {
    return res.status(400).json({ 
      error: 'Moneda no soportada',
      soportadas: ['USD', 'EUR', 'CAD', 'GBP', 'JPY']
    });
  }
  
  if (cantidad) {
    const num = parseFloat(cantidad);
    if (isNaN(num) || num <= 0 || num > 100000) {
      return res.status(400).json({ error: 'Cantidad inválida' });
    }
  }
  
  next();
}

// RUTAS API
app.get('/api/health', async (req, res) => {
  try {
    // Test básico de conectividad
    await axios.get('https://www.banregio.com', { 
      headers, 
      timeout: 5000,
      maxRedirects: 2
    });
    
    res.json({
      status: 'OK',
      service: 'Banregio API (Cheerio)',
      banregio: 'accessible',
      cache: `${cache.size} entries`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({
      status: 'WARNING',
      service: 'Banregio API (Cheerio)',
      banregio: `error: ${error.message}`,
      fallback: 'available',
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/convert', validateParams, async (req, res) => {
  const start = Date.now();
  try {
    const { tipo = 'comprar', moneda = 'USD', cantidad = 300 } = req.body;
    const result = await convertirDivisaConRetry({ 
      tipo, 
      moneda, 
      cantidad: parseFloat(cantidad) 
    });
    
    res.json({
      success: true,
      data: result,
      meta: { 
        processingTimeMs: Date.now() - start,
        method: 'POST'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      meta: { processingTimeMs: Date.now() - start }
    });
  }
});

app.get('/api/convert/:tipo/:moneda/:cantidad', validateParams, async (req, res) => {
  const start = Date.now();
  try {
    const { tipo, moneda, cantidad } = req.params;
    const result = await convertirDivisaConRetry({ 
      tipo, 
      moneda, 
      cantidad: parseFloat(cantidad) 
    });
    
    res.json({
      success: true,
      data: result,
      meta: { 
        processingTimeMs: Date.now() - start,
        method: 'GET'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      meta: { processingTimeMs: Date.now() - start }
    });
  }
});

// Endpoint para ver todas las tasas actuales
app.get('/api/rates', async (req, res) => {
  try {
    const cacheKey = 'banregio-rates';
    let tasas = getCached(cacheKey);
    
    if (!tasas) {
      try {
        tasas = await scrapeBanregio();
        setCache(cacheKey, tasas);
      } catch (error) {
        tasas = getFallbackRates();
      }
    }
    
    res.json({
      success: true,
      data: tasas,
      meta: {
        timestamp: new Date().toISOString(),
        fuente: 'banregio-cheerio',
        cached: getCached(cacheKey) !== null
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Limpiar cache
app.delete('/api/cache', (req, res) => {
  cache.clear();
  res.json({
    success: true,
    message: 'Cache limpiado',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/currencies', (req, res) => {
  res.json({
    success: true,
    data: {
      supported: ['USD', 'EUR', 'CAD', 'GBP', 'JPY'],
      types: ['comprar', 'vender']
    }
  });
});

// Info de la API
app.get('/api/info', (req, res) => {
  res.json({
    service: 'Banregio Currency API (Cheerio)',
    version: '1.0',
    descripcion: 'API para conversión de divisas desde Banregio usando scraping HTML',
    target: 'https://www.banregio.com/divisas.php',
    endpoints: [
      'GET  /api/health',
      'POST /api/convert',
      'GET  /api/convert/:tipo/:moneda/:cantidad',
      'GET  /api/rates',
      'DELETE /api/cache',
      'GET  /api/currencies',
      'GET  /api/info'
    ],
    ejemplo: {
      url: '/api/convert/comprar/USD/500',
      body: { tipo: 'comprar', moneda: 'USD', cantidad: 500 }
    }
  });
});

app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint no encontrado',
    info: '/api/info'
  });
});

// Limpiar cache cada 10 minutos
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      cache.delete(key);
    }
  }
  console.log(`🧹 Cache limpiado automáticamente. Entradas: ${cache.size}`);
}, 10 * 60 * 1000);

const server = app.listen(PORT, () => {
  console.log(`🚀 API Banregio (Cheerio) iniciada en puerto ${PORT}`);
  console.log(`🎯 Target: https://www.banregio.com/divisas.php`);
  console.log(`💡 Modo: Scraping HTML directo + Fallback`);
  console.log(`📋 Info: http://localhost:${PORT}/api/info`);
});

// Graceful shutdown
['SIGTERM', 'SIGINT'].forEach(signal => {
  process.on(signal, () => {
    console.log(`🛑 ${signal} recibido, cerrando...`);
    server.close(() => process.exit(0));
  });
});

module.exports = app;
