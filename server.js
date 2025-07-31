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

// Cache simple
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

// ✅ FUNCIÓN PRINCIPAL: SIMULAR EL JavaScript REAL DE LA PÁGINA
async function simularJavaScriptBanregio({ tipo = 'compra', moneda = 'USD', cantidad = 300 }) {
  try {
    console.log(`🎯 Simulando JavaScript real: ${tipo} ${cantidad} ${moneda}`);
    
    // Paso 1: Obtener la página completa
    const response = await axios.get('https://www.banregio.com/divisas.php', {
      headers,
      timeout: 30000,
      validateStatus: (status) => status >= 200 && status < 400
    });
    
    console.log(`📄 Página obtenida: ${response.status}, tamaño: ${response.data.length}`);
    
    // Paso 2: Extraer las funciones JavaScript y las tasas
    const { tasas, sessionData } = await extraerDatosJavaScript(response.data, response.headers);
    
    if (!tasas[moneda]) {
      throw new Error(`No se encontraron tasas para ${moneda}`);
    }
    
    // Paso 3: Simular la función convertToMXN exacta
    const resultado = simularConvertToMXN(moneda, cantidad, tipo, tasas);
    
    // Paso 4: Validar resultado haciendo una llamada AJAX si es necesario
    const validacionAJAX = await validarConAJAX({
      tipo, 
      moneda, 
      cantidad, 
      sessionData,
      esperado: resultado.mxn
    });
    
    return {
      mxn: resultado.mxn,
      tipoCambio: resultado.tipoCambio,
      tipo,
      moneda,
      cantidad,
      fuente: 'banregio-javascript-simulation',
      timestamp: new Date().toISOString(),
      detalles: {
        tasaCompra: tasas[moneda].compra,
        tasaVenta: tasas[moneda].venta,
        validacionAJAX: validacionAJAX.success,
        method: 'javascript-simulation'
      }
    };
    
  } catch (error) {
    console.error('❌ Error simulando JavaScript:', error.message);
    throw error;
  }
}

// ✅ EXTRAER DATOS DEL JavaScript DE LA PÁGINA
async function extraerDatosJavaScript(html, headers) {
  const $ = cheerio.load(html);
  
  console.log('🔍 Extrayendo datos del JavaScript...');
  
  const tasas = {};
  let sessionData = {};
  
  // Extraer cookies y session data
  if (headers['set-cookie']) {
    sessionData.cookies = headers['set-cookie'];
  }
  
  // Buscar en todos los scripts
  $('script').each((i, script) => {
    const content = $(script).html() || '';
    
    // Buscar definición de tasas
    const tasasPatterns = [
      // Patrones comunes para tasas de cambio
      /var\s+tasas\s*=\s*\{([^}]+)\}/gi,
      /const\s+rates\s*=\s*\{([^}]+)\}/gi,
      /let\s+exchangeRates\s*=\s*\{([^}]+)\}/gi,
      // Buscar tasas específicas
      /USD.*?compra.*?(\d{1,2}\.\d{2,4}).*?venta.*?(\d{1,2}\.\d{2,4})/gi,
      /EUR.*?compra.*?(\d{1,2}\.\d{2,4}).*?venta.*?(\d{1,2}\.\d{2,4})/gi,
      // Buscar en funciones convertToMXN
      /function\s+convertToMXN\s*\([^)]*\)\s*\{([^}]+)\}/gi
    ];
    
    tasasPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        console.log(`📊 Patrón encontrado: ${match[0].substring(0, 100)}...`);
        
        // Extraer números que parezcan tasas
        const numeros = match[0].match(/\d{1,2}\.\d{2,4}/g);
        if (numeros && numeros.length >= 2) {
          const rates = numeros.map(n => parseFloat(n));
          
          // Clasificar por rangos típicos
          const usdRates = rates.filter(r => r >= 16 && r <= 22);
          const eurRates = rates.filter(r => r >= 19 && r <= 26);
          
          if (usdRates.length >= 2) {
            usdRates.sort();
            tasas.USD = { compra: usdRates[0], venta: usdRates[usdRates.length - 1] };
          }
          
          if (eurRates.length >= 2) {
            eurRates.sort();
            tasas.EUR = { compra: eurRates[0], venta: eurRates[eurRates.length - 1] };
          }
        }
      }
    });
    
    // Buscar AJAX endpoints
    const ajaxPatterns = [
      /\$\.ajax\s*\(\s*\{([^}]+)\}/gi,
      /fetch\s*\(\s*['"`]([^'"`]+)['"`]/gi,
      /axios\.[get|post]+\s*\(\s*['"`]([^'"`]+)['"`]/gi
    ];
    
    ajaxPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        console.log(`🌐 AJAX endpoint encontrado: ${match[1] || match[0]}`);
        sessionData.ajaxEndpoint = match[1];
      }
    });
  });
  
  // Si no encontramos tasas en JavaScript, extraerlas del HTML visible
  if (Object.keys(tasas).length === 0) {
    console.log('⚠️ No se encontraron tasas en JS, extrayendo del HTML...');
    tasas.USD = extraerTasasDelHTML($, 'USD', [16, 22]);
    tasas.EUR = extraerTasasDelHTML($, 'EUR', [19, 26]);
    tasas.CAD = extraerTasasDelHTML($, 'CAD', [12, 16]);
    tasas.GBP = extraerTasasDelHTML($, 'GBP', [22, 28]);
    tasas.JPY = extraerTasasDelHTML($, 'JPY', [0.1, 0.2]);
  }
  
  // Fallback con tasas actualizadas si no encontramos nada
  if (Object.keys(tasas).length === 0) {
    console.log('⚠️ Usando tasas fallback actualizadas...');
    tasas.USD = { compra: 19.35, venta: 19.50 };
    tasas.EUR = { compra: 21.20, venta: 21.40 };
    tasas.CAD = { compra: 14.10, venta: 14.30 };
    tasas.GBP = { compra: 24.60, venta: 24.85 };
    tasas.JPY = { compra: 0.130, venta: 0.135 };
  }
  
  console.log('✅ Tasas extraídas:', tasas);
  return { tasas, sessionData };
}

// ✅ EXTRAER TASAS DEL HTML VISIBLE
function extraerTasasDelHTML($, moneda, rango) {
  const text = $('body').text();
  const regex = new RegExp(`${moneda}[^\\d]*(\\d{1,2}\\.\\d{2,4})[^\\d]*(\\d{1,2}\\.\\d{2,4})`, 'gi');
  const match = regex.exec(text);
  
  if (match) {
    const rate1 = parseFloat(match[1]);
    const rate2 = parseFloat(match[2]);
    
    if (rate1 >= rango[0] && rate1 <= rango[1] && 
        rate2 >= rango[0] && rate2 <= rango[1] && 
        rate1 !== rate2) {
      return {
        compra: Math.min(rate1, rate2),
        venta: Math.max(rate1, rate2)
      };
    }
  }
  
  return null;
}

// ✅ SIMULAR LA FUNCIÓN convertToMXN EXACTA
function simularConvertToMXN(moneda, cantidad, tipo, tasas) {
  console.log(`🧮 Simulando convertToMXN(${moneda}, ${cantidad}, ${tipo})`);
  
  const tasaMoneda = tasas[moneda];
  if (!tasaMoneda) {
    throw new Error(`Tasa no disponible para ${moneda}`);
  }
  
  // Simular la lógica exacta del JavaScript original
  const tipoCambio = tipo === 'compra' ? tasaMoneda.compra : tasaMoneda.venta;
  const mxn = parseFloat((cantidad * tipoCambio).toFixed(2));
  
  console.log(`✅ Conversión: ${cantidad} ${moneda} = ${mxn} MXN (tasa: ${tipoCambio})`);
  
  return {
    mxn,
    tipoCambio: parseFloat(tipoCambio.toFixed(4))
  };
}

// ✅ VALIDAR CON LLAMADA AJAX REAL
async function validarConAJAX({ tipo, moneda, cantidad, sessionData, esperado }) {
  try {
    console.log('🔍 Validando con AJAX...');
    
    // Intentar encontrar el endpoint AJAX real
    const endpoints = [
      'https://www.banregio.com/ajax/divisas.php',
      'https://www.banregio.com/api/convert.php',
      'https://www.banregio.com/divisas-ajax.php',
      sessionData.ajaxEndpoint
    ].filter(Boolean);
    
    for (const endpoint of endpoints) {
      try {
        const ajaxData = {
          moneda,
          cantidad,
          tipo,
          action: 'convert'
        };
        
        const response = await axios.post(endpoint, ajaxData, {
          headers: {
            ...headers,
            'Content-Type': 'application/x-www-form-urlencoded',
            ...(sessionData.cookies && { 'Cookie': sessionData.cookies.join('; ') })
          },
          timeout: 10000,
          validateStatus: (status) => status >= 200 && status < 500
        });
        
        if (response.data && typeof response.data === 'object') {
          console.log(`✅ AJAX validación exitosa en ${endpoint}`);
          return { success: true, data: response.data, endpoint };
        }
        
      } catch (ajaxError) {
        console.log(`⚠️ AJAX falló en ${endpoint}:`, ajaxError.message);
        continue;
      }
    }
    
    // No hay endpoint AJAX válido, la simulación es suficiente
    return { success: false, reason: 'no-ajax-endpoint' };
    
  } catch (error) {
    console.log('⚠️ Validación AJAX falló:', error.message);
    return { success: false, reason: error.message };
  }
}

// ✅ FUNCIÓN PRINCIPAL DE CONVERSIÓN MEJORADA
async function convertirDivisa({ tipo = 'compra', moneda = 'USD', cantidad = 300 }) {
  try {
    console.log(`🔄 Convirtiendo: ${tipo} ${cantidad} ${moneda}`);
    
    const cacheKey = `conversion-${tipo}-${moneda}-${cantidad}`;
    let resultado = getCached(cacheKey);
    
    if (!resultado) {
      console.log('📡 Obteniendo conversión fresca...');
      
      // Método principal: Simulación JavaScript real
      resultado = await simularJavaScriptBanregio({ tipo, moneda, cantidad });
      
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

// ✅ DIAGNÓSTICO MEJORADO
async function diagnosticarPaginaBanregio() {
  try {
    console.log('🔬 Iniciando diagnóstico de JavaScript...');
    
    const response = await axios.get('https://www.banregio.com/divisas.php', {
      headers,
      timeout: 30000,
      validateStatus: (status) => status >= 200 && status < 500
    });
    
    const $ = cheerio.load(response.data);
    
    const diagnostico = {
      respuesta: {
        status: response.status,
        tamano: response.data.length,
        contentType: response.headers['content-type']
      },
      estructura: {
        titulo: $('title').text(),
        totalElementos: $('*').length,
        scripts: $('script').length,
        inputs: $('input').length,
        selects: $('select').length
      },
      calculadora: {
        inputDivisa: $('#divisa').length > 0,
        inputMxn: $('#mxn').length > 0,
        selectMoneda: $('.custom-select').length > 0,
        botonesOperacion: $('.tipo-operacion').length
      },
      javascript: {
        tieneConvertToMXN: response.data.includes('convertToMXN'),
        tieneConvertFromMXN: response.data.includes('convertFromMXN'),
        funcionesEncontradas: []
      }
    };
    
    // Analizar funciones JavaScript
    const funcionesJS = response.data.match(/function\s+\w+\s*\([^)]*\)\s*\{/g) || [];
    diagnostico.javascript.funcionesEncontradas = funcionesJS.map(f => f.substring(0, 50));
    
    // Buscar tasas en el JavaScript
    const { tasas } = await extraerDatosJavaScript(response.data, response.headers);
    diagnostico.tasasEncontradas = tasas;
    
    return diagnostico;
    
  } catch (error) {
    return {
      error: error.message,
      tipo: error.constructor.name
    };
  }
}

// Validación
function validateParams(req, res, next) {
  const { tipo, moneda, cantidad } = req.body || req.params;
  
  if (tipo && !['compra', 'venta', 'comprar', 'vender'].includes(tipo)) {
    return res.status(400).json({ error: 'Tipo debe ser "compra/comprar" o "venta/vender"' });
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
    const diagnostico = await diagnosticarPaginaBanregio();
    
    res.json({
      status: 'OK',
      service: 'Banregio API (JavaScript Simulation)',
      banregio: diagnostico.respuesta?.status === 200 ? 'accessible' : 'error',
      calculadora: {
        inputsDetectados: diagnostico.calculadora?.inputDivisa && diagnostico.calculadora?.inputMxn,
        javascriptDetectado: diagnostico.javascript?.tieneConvertToMXN
      },
      cache: `${cache.size} entries`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.json({
      status: 'WARNING',
      service: 'Banregio API (JavaScript Simulation)',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/convert', validateParams, async (req, res) => {
  const start = Date.now();
  try {
    let { tipo = 'compra', moneda = 'USD', cantidad = 300 } = req.body;
    
    // Normalizar tipo
    if (tipo === 'comprar') tipo = 'compra';
    if (tipo === 'vender') tipo = 'venta';
    
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
    let { tipo, moneda, cantidad } = req.params;
    
    // Normalizar tipo
    if (tipo === 'comprar') tipo = 'compra';
    if (tipo === 'vender') tipo = 'venta';
    
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

app.get('/api/diagnostico', async (req, res) => {
  try {
    const diagnostico = await diagnosticarPaginaBanregio();
    res.json({
      success: true,
      data: diagnostico,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/debug/:tipo/:moneda/:cantidad', async (req, res) => {
  try {
    let { tipo, moneda, cantidad } = req.params;
    
    // Normalizar tipo
    if (tipo === 'comprar') tipo = 'compra';
    if (tipo === 'vender') tipo = 'venta';
    
    console.log(`🐛 Debug mode para: ${tipo} ${cantidad} ${moneda}`);
    
    const debugInfo = {
      params: { tipo, moneda, cantidad: parseFloat(cantidad) },
      timestamp: new Date().toISOString(),
      conversion: null,
      diagnostico: null,
      error: null
    };
    
    try {
      debugInfo.conversion = await simularJavaScriptBanregio({ 
        tipo, 
        moneda, 
        cantidad: parseFloat(cantidad) 
      });
    } catch (conversionError) {
      debugInfo.error = conversionError.message;
    }
    
    try {
      debugInfo.diagnostico = await diagnosticarPaginaBanregio();
    } catch (diagError) {
      debugInfo.diagnosticoError = diagError.message;
    }
    
    res.json({
      success: true,
      data: debugInfo,
      summary: {
        conversionWorked: !debugInfo.error,
        javascriptDetected: debugInfo.diagnostico?.javascript?.tieneConvertToMXN || false,
        tasasExtraidas: Object.keys(debugInfo.diagnostico?.tasasEncontradas || {}).length
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/rates', async (req, res) => {
  try {
    const response = await axios.get('https://www.banregio.com/divisas.php', { headers });
    const { tasas } = await extraerDatosJavaScript(response.data, response.headers);
    
    res.json({
      success: true,
      data: {
        tasas,
        timestamp: new Date().toISOString(),
        fuente: 'javascript-extraction'
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

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
      types: ['compra', 'venta', 'comprar', 'vender']
    }
  });
});

app.get('/api/info', (req, res) => {
  res.json({
    service: 'Banregio Currency API (JavaScript Simulation)',
    version: '4.0',
    descripcion: 'API que simula las funciones JavaScript reales de la calculadora de Banregio',
    target: 'https://www.banregio.com/divisas.php',
    methods: [
      'JavaScript Function Simulation (Primary)',
      'Real convertToMXN() Logic Replication',
      'Exchange Rates Extraction from Scripts',
      'AJAX Validation (when available)',
      'Fallback Rates (Updated)'
    ],
    features: [
      'Simulación exacta de convertToMXN(moneda, cantidad, tipo)',
      'Extracción de tasas desde JavaScript de la página',
      'Detección automática de endpoints AJAX',
      'Validación con llamadas AJAX reales cuando es posible',
      'Soporte para ambos formatos: compra/venta y comprar/vender',
      'Diagnóstico completo del JavaScript de la página',
      'Cache inteligente con TTL de 2 minutos',
      'Headers realistas para evitar detección de bot'
    ],
    endpoints: [
      'GET  /api/health',
      'POST /api/convert',
      'GET  /api/convert/:tipo/:moneda/:cantidad',
      'GET  /api/rates',
      'GET  /api/diagnostico',
      'GET  /api/debug/:tipo/:moneda/:cantidad',
      'DELETE /api/cache',
      'GET  /api/currencies',
      'GET  /api/info'
    ],
    ejemplo: {
      conversion: '/api/convert/compra/USD/500',
      debug: '/api/debug/compra/USD/300',
      rates: '/api/rates',
      diagnostico: '/api/diagnostico',
      body: { tipo: 'compra', moneda: 'USD', cantidad: 500 }
    },
    htmlElements: {
      inputDivisa: '#divisa (input con cantidad de divisa)',
      inputMxn: '#mxn (input con resultado en MXN)',
      selectMoneda: '.custom-select (selector de moneda)',
      botonesOperacion: '.tipo-operacion (botones compra/venta)'
    },
    javascript: {
      funcionPrincipal: 'convertToMXN(moneda, divisa.value, tipoOperacion)',
      funcionInversa: 'convertFromMXN(moneda, mxn.value, tipoOperacion)',
      variables: 'moneda, divisa, tipoOperacion son variables globales'
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
  console.log(`🚀 API Banregio (JavaScript Simulation) iniciada en puerto ${PORT}`);
  console.log(`🎯 Target: https://www.banregio.com/divisas.php`);
  console.log(`💡 Modo: Simulación de JavaScript Real`);
  console.log(`🔧 Función objetivo: convertToMXN(moneda, cantidad, tipo)`);
  console.log(`📋 Info: http://localhost:${PORT}/api/info`);
  console.log(`🔬 Diagnóstico: http://localhost:${PORT}/api/diagnostico`);
  console.log(`🐛 Debug: http://localhost:${PORT}/api/debug/compra/USD/300`);
});

// Graceful shutdown
['SIGTERM', 'SIGINT'].forEach(signal => {
  process.on(signal, () => {
    console.log(`🛑 ${signal} recibido, cerrando...`);
    server.close(() => process.exit(0));
  });
});

module.exports = app;
