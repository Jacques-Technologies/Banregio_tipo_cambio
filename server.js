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
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'es-ES,es;q=0.8,en-US;q=0.5,en;q=0.3',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'X-Requested-With': 'XMLHttpRequest',
  'Cache-Control': 'no-cache',
  'Referer': 'https://www.banregio.com/divisas.php'
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

// ✅ FUNCIÓN PARA OBTENER APIS INTERNAS DE LA CALCULADORA
async function obtenerAPIsCalculadora() {
  try {
    console.log('🔍 Analizando APIs de la calculadora...');
    
    const response = await axios.get('https://www.banregio.com/divisas.php', {
      headers: {
        ...headers,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      },
      timeout: 15000
    });
    
    const html = response.data;
    const $ = cheerio.load(html);
    
    // Buscar scripts que contengan URLs de API o endpoints
    const apis = {
      endpoints: [],
      methods: [],
      params: []
    };
    
    $('script').each((i, script) => {
      const content = $(script).html();
      if (content) {
        // Buscar URLs de API
        const urlMatches = content.match(/['"](\/api\/[^'"]*|\/ajax\/[^'"]*|\/ws\/[^'"]*)['"]/gi);
        if (urlMatches) {
          urlMatches.forEach(url => {
            const cleanUrl = url.replace(/['"]/g, '');
            if (!apis.endpoints.includes(cleanUrl)) {
              apis.endpoints.push(cleanUrl);
            }
          });
        }
        
        // Buscar métodos AJAX
        const ajaxMatches = content.match(/\$\.ajax\s*\(\s*\{([^}]+)\}/gi);
        if (ajaxMatches) {
          ajaxMatches.forEach(match => apis.methods.push(match));
        }
        
        // Buscar parámetros de divisas
        const paramMatches = content.match(/(divisa|moneda|cantidad|tipo|mxn)[^=]*=([^;,\n]+)/gi);
        if (paramMatches) {
          paramMatches.forEach(param => apis.params.push(param));
        }
      }
    });
    
    console.log('🔍 APIs encontradas:', apis);
    return apis;
    
  } catch (error) {
    console.error('❌ Error obteniendo APIs:', error.message);
    return { endpoints: [], methods: [], params: [] };
  }
}

// ✅ FUNCIÓN PARA SIMULAR CALCULADORA AJAX
async function simularCalculadoraAjax({ tipo = 'comprar', moneda = 'USD', cantidad = 300 }) {
  try {
    console.log(`🎯 Simulando calculadora AJAX: ${tipo} ${cantidad} ${moneda}`);
    
    // Primero obtener la página para extraer tokens/sesiones
    const pageResponse = await axios.get('https://www.banregio.com/divisas.php', {
      headers: {
        ...headers,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      }
    });
    
    const $ = cheerio.load(pageResponse.data);
    
    // Extraer posibles tokens CSRF o parámetros de sesión
    let csrfToken = null;
    let sessionId = null;
    
    $('input[name*="token"], input[name*="csrf"], meta[name*="token"]').each((i, el) => {
      const name = $(el).attr('name') || $(el).attr('property');
      const value = $(el).attr('value') || $(el).attr('content');
      if (name && value) {
        csrfToken = value;
      }
    });
    
    // Intentar diferentes endpoints posibles para la calculadora
    const possibleEndpoints = [
      '/api/divisas/convert',
      '/ajax/divisas.php',
      '/ws/divisas',
      '/divisas/calculate',
      '/api/currency/convert',
      'divisas.php' // Mismo archivo con POST
    ];
    
    for (const endpoint of possibleEndpoints) {
      try {
        console.log(`🔄 Probando endpoint: ${endpoint}`);
        
        const url = endpoint.startsWith('/') ? 
          `https://www.banregio.com${endpoint}` : 
          `https://www.banregio.com/${endpoint}`;
        
        // Preparar datos de la petición
        const postData = {
          tipo: tipo,
          moneda: moneda,
          cantidad: cantidad,
          divisa: cantidad,
          currency: moneda,
          action: 'calculate',
          ...(csrfToken && { _token: csrfToken, csrf_token: csrfToken })
        };
        
        const formData = new URLSearchParams(postData).toString();
        
        // Hacer petición POST
        const response = await axios.post(url, formData, {
          headers: {
            ...headers,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
          },
          timeout: 10000,
          validateStatus: (status) => status < 500
        });
        
        console.log(`📡 Respuesta ${endpoint}:`, response.status, typeof response.data);
        
        // Verificar si la respuesta contiene datos útiles
        if (response.data && typeof response.data === 'object') {
          if (response.data.mxn || response.data.resultado || response.data.total) {
            console.log('✅ Endpoint funcional encontrado:', endpoint);
            return {
              endpoint,
              data: response.data,
              success: true
            };
          }
        }
        
        // Si es HTML, buscar el valor MXN en la respuesta
        if (typeof response.data === 'string' && response.data.includes('mxn')) {
          const $response = cheerio.load(response.data);
          const mxnValue = $response('#mxn').val() || $response('[name="mxn"]').val();
          
          if (mxnValue && parseFloat(mxnValue) > 0) {
            console.log('✅ Valor MXN encontrado en HTML:', mxnValue);
            return {
              endpoint,
              data: { mxn: parseFloat(mxnValue), raw: mxnValue },
              success: true
            };
          }
        }
        
      } catch (endpointError) {
        console.log(`❌ Error en ${endpoint}:`, endpointError.message);
        continue;
      }
    }
    
    throw new Error('No se encontró endpoint funcional para la calculadora');
    
  } catch (error) {
    console.error('❌ Error simulando AJAX:', error.message);
    throw error;
  }
}

// ✅ FUNCIÓN ALTERNATIVA: REVERSE ENGINEERING DE LA LÓGICA
async function calcularConLogicaReversa({ tipo = 'comprar', moneda = 'USD', cantidad = 300 }) {
  try {
    console.log(`🧮 Calculando con lógica reversa: ${tipo} ${cantidad} ${moneda}`);
    
    // Obtener la página y extraer las tasas actuales
    const response = await axios.get('https://www.banregio.com/divisas.php', {
      headers: {
        ...headers,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      }
    });
    
    const $ = cheerio.load(response.data);
    
    // Extraer las tasas desde la página
    const tasas = {};
    
    // Estrategia 1: Buscar en scripts con datos JSON
    $('script').each((i, script) => {
      const content = $(script).html();
      if (content && (content.includes('USD') || content.includes('divisas'))) {
        // Buscar objetos que parezcan tasas de cambio
        const ratePatterns = [
          /(\w{3})\s*[:=]\s*\{\s*['"]*compra['"]*\s*[:=]\s*([\d.]+)[^}]*['"]*venta['"]*\s*[:=]\s*([\d.]+)/gi,
          /['"]*(\w{3})['"]*\s*[:=]\s*\[([\d.]+),\s*([\d.]+)\]/gi,
          /(\w{3}).*?([\d.]{4,6}).*?([\d.]{4,6})/gi
        ];
        
        ratePatterns.forEach(pattern => {
          let match;
          while ((match = pattern.exec(content)) !== null) {
            const [, currency, rate1, rate2] = match;
            if (currency && rate1 && rate2) {
              const num1 = parseFloat(rate1);
              const num2 = parseFloat(rate2);
              if (num1 > 0 && num2 > 0 && num1 !== num2) {
                tasas[currency.toUpperCase()] = {
                  compra: Math.min(num1, num2),
                  venta: Math.max(num1, num2)
                };
              }
            }
          }
        });
      }
    });
    
    // Estrategia 2: Buscar en elementos HTML visibles
    $('.currency-rate, .exchange-rate, .divisa-rate').each((i, el) => {
      const text = $(el).text();
      const currencyMatch = text.match(/(USD|EUR|CAD|GBP|JPY)/i);
      const rateMatches = text.match(/([\d.]+)/g);
      
      if (currencyMatch && rateMatches && rateMatches.length >= 2) {
        const currency = currencyMatch[0].toUpperCase();
        const rates = rateMatches.map(r => parseFloat(r)).filter(r => r > 0.01);
        
        if (rates.length >= 2) {
          tasas[currency] = {
            compra: Math.min(...rates),
            venta: Math.max(...rates)
          };
        }
      }
    });
    
    // Estrategia 3: Buscar patrones en todo el texto
    const fullText = $.text();
    const currencies = ['USD', 'EUR', 'CAD', 'GBP', 'JPY'];
    
    currencies.forEach(currency => {
      const regex = new RegExp(`${currency}[^\\d]*(\\d{1,2}\\.\\d{2,4})[^\\d]*(\\d{1,2}\\.\\d{2,4})`, 'gi');
      const match = regex.exec(fullText);
      
      if (match) {
        const rate1 = parseFloat(match[1]);
        const rate2 = parseFloat(match[2]);
        
        if (rate1 > 0 && rate2 > 0 && Math.abs(rate1 - rate2) > 0.1) {
          tasas[currency] = {
            compra: Math.min(rate1, rate2),
            venta: Math.max(rate1, rate2)
          };
        }
      }
    });
    
    console.log('📊 Tasas extraídas:', tasas);
    
    // Usar la tasa encontrada o fallback
    let tasaMoneda = tasas[moneda];
    
    if (!tasaMoneda) {
      console.log('⚠️ No se encontró tasa para', moneda, ', usando fallback');
      const fallbackRates = getFallbackRates();
      tasaMoneda = fallbackRates[moneda];
    }
    
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
      fuente: 'banregio-reverse-logic',
      timestamp: new Date().toISOString(),
      detalles: {
        tasaCompra: tasaMoneda.compra,
        tasaVenta: tasaMoneda.venta,
        fuenteDatos: tasas[moneda] ? 'extraida' : 'fallback',
        tasasEncontradas: Object.keys(tasas)
      }
    };
    
  } catch (error) {
    console.error('❌ Error en lógica reversa:', error.message);
    throw error;
  }
}

// ✅ FUNCIÓN FALLBACK CON VALORES APROXIMADOS
function getFallbackRates() {
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
    console.log(`🔄 Convirtiendo: ${tipo} ${cantidad} ${moneda}`);
    
    const cacheKey = `conversion-${tipo}-${moneda}-${cantidad}`;
    let resultado = getCached(cacheKey);
    
    if (!resultado) {
      console.log('📡 Obteniendo conversión fresca...');
      
      // Intentar método 1: Simulación AJAX
      try {
        console.log('🎯 Intentando simulación AJAX...');
        const ajaxResult = await simularCalculadoraAjax({ tipo, moneda, cantidad });
        
        if (ajaxResult.success && ajaxResult.data.mxn) {
          const mxnValue = parseFloat(ajaxResult.data.mxn);
          const tipoCambio = mxnValue / cantidad;
          
          resultado = {
            mxn: parseFloat(mxnValue.toFixed(2)),
            tipoCambio: parseFloat(tipoCambio.toFixed(4)),
            tipo,
            moneda,
            cantidad,
            fuente: 'banregio-ajax',
            timestamp: new Date().toISOString(),
            detalles: {
              endpoint: ajaxResult.endpoint,
              rawData: ajaxResult.data,
              fuenteDatos: 'ajax-simulation'
            }
          };
        }
      } catch (ajaxError) {
        console.log('⚠️ Simulación AJAX falló:', ajaxError.message);
      }
      
      // Método 2: Lógica reversa si AJAX no funcionó
      if (!resultado) {
        console.log('🧮 Usando lógica reversa...');
        resultado = await calcularConLogicaReversa({ tipo, moneda, cantidad });
      }
      
      setCache(cacheKey, resultado);
      console.log('✅ Conversión obtenida y guardada en cache');
    } else {
      console.log('✅ Usando conversión desde cache');
    }
    
    return resultado;
    
  } catch (error) {
    console.error('❌ Error en conversión:', error.message);
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
    await axios.get('https://www.banregio.com/divisas.php', { 
      headers, 
      timeout: 5000,
      maxRedirects: 2
    });
    
    res.json({
      status: 'OK',
      service: 'Banregio API (Ajax + Reverse Logic)',
      banregio: 'accessible',
      cache: `${cache.size} entries`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({
      status: 'WARNING',
      service: 'Banregio API (Ajax + Reverse Logic)',
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

// Endpoint para análisis de APIs
app.get('/api/analyze', async (req, res) => {
  try {
    const apis = await obtenerAPIsCalculadora();
    res.json({
      success: true,
      data: apis,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para ver todas las tasas actuales
app.get('/api/rates', async (req, res) => {
  try {
    const resultado = await calcularConLogicaReversa({ tipo: 'comprar', moneda: 'USD', cantidad: 1 });
    
    res.json({
      success: true,
      data: resultado.detalles,
      meta: {
        timestamp: new Date().toISOString(),
        fuente: resultado.fuente
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
    service: 'Banregio Currency API (Ajax + Reverse Logic)',
    version: '2.0',
    descripcion: 'API para conversión de divisas desde Banregio usando simulación AJAX y lógica reversa',
    target: 'https://www.banregio.com/divisas.php',
    methods: ['Ajax Simulation', 'Reverse Logic', 'Fallback Rates'],
    endpoints: [
      'GET  /api/health',
      'POST /api/convert',
      'GET  /api/convert/:tipo/:moneda/:cantidad',
      'GET  /api/rates',
      'GET  /api/analyze',
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
  console.log(`🚀 API Banregio (Ajax + Reverse Logic) iniciada en puerto ${PORT}`);
  console.log(`🎯 Target: https://www.banregio.com/divisas.php`);
  console.log(`💡 Modo: Ajax Simulation + Reverse Logic + Fallback`);
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
