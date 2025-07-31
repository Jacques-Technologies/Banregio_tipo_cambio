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

// ✅ FUNCIÓN PARA ANÁLISIS DETALLADO DEL HTML (DEBUG)
async function analizarHTMLDetallado() {
  try {
    console.log('🔍 Iniciando análisis detallado del HTML...');
    
    const response = await axios.get('https://www.banregio.com/divisas.php', {
      headers: {
        ...headers,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      }
    });
    
    const $ = cheerio.load(response.data);
    const analysis = {
      pageInfo: {
        title: $('title').text().trim(),
        htmlSize: response.data.length,
        timestamp: new Date().toISOString()
      },
      elements: {
        scripts: [],
        inputs: [],
        selects: [],
        forms: [],
        tables: [],
        divs: []
      },
      content: {
        allNumbers: [],
        currencyMentions: {},
        potentialRates: []
      }
    };
    
    // Analizar scripts
    $('script').each((i, script) => {
      const content = $(script).html();
      const src = $(script).attr('src');
      
      if (content) {
        const hasNumbers = /\d{1,2}\.\d{2,4}/.test(content);
        const hasCurrency = /(USD|EUR|CAD|GBP|JPY|divisa|currency)/i.test(content);
        const hasAjax = /(ajax|xhr|fetch|post|get)/i.test(content);
        
        analysis.elements.scripts.push({
          index: i,
          size: content.length,
          hasNumbers,
          hasCurrency,
          hasAjax,
          preview: content.substring(0, 200).replace(/\s+/g, ' ')
        });
      } else if (src) {
        analysis.elements.scripts.push({
          index: i,
          external: true,
          src
        });
      }
    });
    
    // Analizar inputs
    $('input').each((i, input) => {
      const $input = $(input);
      analysis.elements.inputs.push({
        index: i,
        id: $input.attr('id'),
        name: $input.attr('name'),
        type: $input.attr('type'),
        class: $input.attr('class'),
        value: $input.attr('value') || $input.val(),
        placeholder: $input.attr('placeholder')
      });
    });
    
    // Analizar selects
    $('select').each((i, select) => {
      const $select = $(select);
      const options = $select.find('option').map((j, opt) => ({
        value: $(opt).attr('value'),
        text: $(opt).text().trim()
      })).get();
      
      analysis.elements.selects.push({
        index: i,
        id: $select.attr('id'),
        name: $select.attr('name'),
        class: $select.attr('class'),
        options
      });
    });
    
    // Analizar formularios
    $('form').each((i, form) => {
      const $form = $(form);
      analysis.elements.forms.push({
        index: i,
        action: $form.attr('action'),
        method: $form.attr('method'),
        id: $form.attr('id'),
        class: $form.attr('class')
      });
    });
    
    // Analizar tablas
    $('table').each((i, table) => {
      const $table = $(table);
      const rows = $table.find('tr').length;
      const cells = $table.find('td, th').length;
      const text = $table.text().replace(/\s+/g, ' ').trim();
      
      analysis.elements.tables.push({
        index: i,
        rows,
        cells,
        class: $table.attr('class'),
        preview: text.substring(0, 200),
        hasCurrency: /(USD|EUR|CAD|GBP|JPY)/i.test(text),
        hasNumbers: /\d{1,2}\.\d{2,4}/.test(text)
      });
    });
    
    // Analizar divs importantes
    $('div[class*="divisa"], div[class*="currency"], div[class*="exchange"], div[id*="calc"]').each((i, div) => {
      const $div = $(div);
      const text = $div.text().replace(/\s+/g, ' ').trim();
      
      analysis.elements.divs.push({
        index: i,
        id: $div.attr('id'),
        class: $div.attr('class'),
        preview: text.substring(0, 200),
        hasNumbers: /\d{1,2}\.\d{2,4}/.test(text)
      });
    });
    
    // Analizar contenido numérico
    const allText = response.data.replace(/<[^>]+>/g, ' ');
    const numbers = allText.match(/\b\d{1,2}\.\d{2,4}\b/g) || [];
    analysis.content.allNumbers = [...new Set(numbers)].map(n => parseFloat(n)).sort((a, b) => a - b);
    
    // Buscar menciones de monedas
    const currencies = ['USD', 'EUR', 'CAD', 'GBP', 'JPY'];
    currencies.forEach(currency => {
      const mentions = (allText.match(new RegExp(currency, 'gi')) || []).length;
      analysis.content.currencyMentions[currency] = mentions;
    });
    
    // Identificar posibles tasas
    analysis.content.potentialRates = analysis.content.allNumbers.filter(n => 
      (n >= 15 && n <= 25) || // USD range
      (n >= 18 && n <= 30) || // EUR range
      (n >= 12 && n <= 16) || // CAD range
      (n >= 20 && n <= 28) || // GBP range
      (n >= 0.1 && n <= 0.2)  // JPY range
    );
    
    return analysis;
    
  } catch (error) {
    console.error('❌ Error en análisis detallado:', error.message);
    throw error;
  }
}

// ✅ FUNCIÓN PARA SIMULAR CALCULADORA AJAX
async function simularCalculadoraAjax({ tipo = 'comprar', moneda = 'USD', cantidad = 300 }) {
  try {
    console.log(`🎯 Simulando calculadora AJAX: ${tipo} ${cantidad} ${moneda}`);
    
    // Primero obtener la página para extraer tokens/sesiones y cookies
    const pageResponse = await axios.get('https://www.banregio.com/divisas.php', {
      headers: {
        ...headers,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      }
    });
    
    const $ = cheerio.load(pageResponse.data);
    const cookies = pageResponse.headers['set-cookie'];
    
    console.log('🍪 Cookies obtenidas:', cookies ? cookies.length : 0);
    
    // Extraer posibles tokens CSRF o parámetros de sesión
    let csrfToken = null;
    
    $('input[name*="token"], input[name*="csrf"], meta[name*="token"], meta[name*="_token"]').each((i, el) => {
      const name = $(el).attr('name') || $(el).attr('property') || $(el).attr('content');
      const value = $(el).attr('value') || $(el).attr('content');
      if (name && value && value.length > 10) {
        csrfToken = value;
        console.log('🔑 Token encontrado:', name, '=', value.substring(0, 20) + '...');
      }
    });
    
    // Buscar formularios y sus parámetros
    const formParams = {};
    $('form input, form select').each((i, el) => {
      const name = $(el).attr('name');
      const value = $(el).attr('value') || $(el).val();
      if (name && value) {
        formParams[name] = value;
      }
    });
    
    console.log('📝 Parámetros del formulario encontrados:', Object.keys(formParams));
    
    // Intentar diferentes variaciones de petición al mismo divisas.php
    const requestVariations = [
      {
        method: 'POST',
        endpoint: 'divisas.php',
        data: {
          tipo,
          moneda,
          cantidad,
          action: 'convert',
          ajax: '1',
          ...formParams,
          ...(csrfToken && { _token: csrfToken })
        },
        contentType: 'application/x-www-form-urlencoded'
      },
      {
        method: 'POST',
        endpoint: 'divisas.php',
        data: {
          divisa: cantidad,
          currency: moneda,
          operation: tipo,
          calculate: 'true',
          ...formParams
        },
        contentType: 'application/x-www-form-urlencoded'
      },
      {
        method: 'GET',
        endpoint: 'divisas.php',
        data: {
          tipo,
          moneda,
          cantidad,
          ajax: '1'
        },
        contentType: null
      },
      {
        method: 'POST',
        endpoint: 'divisas.php',
        data: JSON.stringify({
          tipo,
          moneda,
          cantidad
        }),
        contentType: 'application/json'
      }
    ];
    
    for (const variation of requestVariations) {
      try {
        console.log(`🔄 Probando variación: ${variation.method} ${variation.endpoint}`);
        console.log('📤 Datos:', variation.data);
        
        const url = `https://www.banregio.com/${variation.endpoint}`;
        
        const requestHeaders = {
          ...headers,
          ...(cookies && { 'Cookie': cookies.join('; ') }),
          ...(variation.contentType && { 'Content-Type': variation.contentType })
        };
        
        let response;
        
        if (variation.method === 'GET') {
          const params = new URLSearchParams(variation.data).toString();
          response = await axios.get(`${url}?${params}`, {
            headers: requestHeaders,
            timeout: 10000,
            validateStatus: (status) => status < 500
          });
        } else {
          const requestData = variation.contentType === 'application/json' 
            ? variation.data 
            : new URLSearchParams(variation.data).toString();
            
          response = await axios.post(url, requestData, {
            headers: requestHeaders,
            timeout: 10000,
            validateStatus: (status) => status < 500
          });
        }
        
        console.log(`📡 Respuesta ${variation.method} ${variation.endpoint}:`, response.status, typeof response.data, response.data.length || 0);
        
        // Verificar si la respuesta contiene datos JSON útiles
        if (response.data && typeof response.data === 'object') {
          if (response.data.mxn || response.data.resultado || response.data.total || response.data.value) {
            console.log('✅ Respuesta JSON funcional encontrada:', response.data);
            return {
              endpoint: variation.endpoint,
              method: variation.method,
              data: response.data,
              success: true
            };
          }
        }
        
        // Si es HTML, analizar más profundamente
        if (typeof response.data === 'string') {
          const $response = cheerio.load(response.data);
          
          // Buscar valor MXN actualizado
          const possibleMxnSelectors = [
            '#mxn',
            'input[name="mxn"]',
            'input[id*="mxn"]',
            '.mxn-value',
            '[data-mxn]',
            'input[type="text"][value*="."]'
          ];
          
          for (const selector of possibleMxnSelectors) {
            const element = $response(selector);
            const value = element.val() || element.text() || element.attr('value');
            
            if (value && /^\d+\.?\d*$/.test(value.replace(/[,$]/g, ''))) {
              const numValue = parseFloat(value.replace(/[,$]/g, ''));
              if (numValue > cantidad * 10 && numValue < cantidad * 30) { // Rango razonable
                console.log(`✅ Valor MXN encontrado con ${selector}:`, value);
                return {
                  endpoint: variation.endpoint,
                  method: variation.method,
                  data: { mxn: numValue, raw: value, selector },
                  success: true
                };
              }
            }
          }
          
          // Buscar cualquier número que se vea como resultado de conversión
          const numbers = response.data.match(/\d{3,6}\.\d{2}/g);
          if (numbers) {
            const potentialResults = numbers.map(n => parseFloat(n))
              .filter(n => n > cantidad * 10 && n < cantidad * 30);
            
            if (potentialResults.length > 0) {
              console.log('✅ Posible resultado de conversión encontrado:', potentialResults[0]);
              return {
                endpoint: variation.endpoint,
                method: variation.method,
                data: { mxn: potentialResults[0], raw: potentialResults[0].toString(), source: 'regex' },
                success: true
              };
            }
          }
        }
        
      } catch (variationError) {
        console.log(`❌ Error en variación ${variation.method} ${variation.endpoint}:`, variationError.message);
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
    const html = response.data;
    
    console.log('📄 Tamaño HTML recibido:', html.length, 'chars');
    console.log('🔍 Buscando elementos clave...');
    
    // Debug: Ver estructura de la página
    console.log('🏗️ Títulos encontrados:', $('h1, h2, h3').map((i, el) => $(el).text().trim()).get());
    console.log('📋 Tablas encontradas:', $('table').length);
    console.log('💱 Elementos con "divisa":', $('*').filter((i, el) => $(el).text().toLowerCase().includes('divisa')).length);
    
    // Extraer las tasas desde la página
    const tasas = {};
    const debugInfo = {
      strategiesUsed: [],
      patternsFound: [],
      elementsAnalyzed: 0
    };
    
    // Estrategia 1: Análisis profundo de scripts
    debugInfo.strategiesUsed.push('script-analysis');
    $('script').each((i, script) => {
      const content = $(script).html();
      if (content) {
        debugInfo.elementsAnalyzed++;
        
        // Buscar variables con nombres relacionados a divisas
        const variablePatterns = [
          /(?:var|let|const)\s+(\w*(?:rate|divisa|currency|exchange)\w*)\s*=\s*([^;]+);/gi,
          /(\w+)\s*[:=]\s*\{[^}]*(?:compra|venta|buy|sell)[^}]*\}/gi,
          /(?:USD|EUR|CAD|GBP|JPY).*?(\d{1,2}\.\d{2,4})/gi
        ];
        
        variablePatterns.forEach((pattern, idx) => {
          let match;
          while ((match = pattern.exec(content)) !== null) {
            debugInfo.patternsFound.push(`script-pattern-${idx}: ${match[0].substring(0, 100)}`);
          }
        });
        
        // Buscar números que parezcan tasas de cambio (15-25 para USD, 18-30 para EUR)
        const usdRates = content.match(/\b(1[6-9]|2[0-4])\.\d{2,4}\b/g);
        const eurRates = content.match(/\b(1[8-9]|2[0-9]|3[0-2])\.\d{2,4}\b/g);
        
        if (usdRates && usdRates.length >= 2) {
          const rates = usdRates.map(r => parseFloat(r)).sort((a, b) => a - b);
          tasas.USD = { compra: rates[0], venta: rates[rates.length - 1] };
          debugInfo.patternsFound.push(`USD rates in script: ${usdRates.join(', ')}`);
        }
        
        if (eurRates && eurRates.length >= 2) {
          const rates = eurRates.map(r => parseFloat(r)).sort((a, b) => a - b);
          tasas.EUR = { compra: rates[0], venta: rates[rates.length - 1] };
          debugInfo.patternsFound.push(`EUR rates in script: ${eurRates.join(', ')}`);
        }
      }
    });
    
    // Estrategia 2: Análisis de tablas y elementos estructurados
    debugInfo.strategiesUsed.push('table-analysis');
    $('table, .table, [class*="divisa"], [class*="currency"], [class*="exchange"]').each((i, el) => {
      const $el = $(el);
      const text = $el.text();
      debugInfo.elementsAnalyzed++;
      
      console.log(`📊 Analizando elemento ${i}:`, $el.prop('tagName'), $el.attr('class'), '- Texto:', text.substring(0, 200));
      
      // Buscar patrones en el texto del elemento
      const currencies = ['USD', 'EUR', 'CAD', 'GBP', 'JPY'];
      currencies.forEach(currency => {
        const currencyRegex = new RegExp(`${currency}[^\\d]*((\\d{1,2}\\.\\d{2,4})[^\\d]*)+`, 'gi');
        const match = currencyRegex.exec(text);
        
        if (match) {
          const numbers = text.match(/\d{1,2}\.\d{2,4}/g);
          if (numbers && numbers.length >= 2) {
            const rates = numbers.map(n => parseFloat(n)).filter(n => n > 10 && n < 35);
            if (rates.length >= 2) {
              rates.sort((a, b) => a - b);
              tasas[currency] = { compra: rates[0], venta: rates[rates.length - 1] };
              debugInfo.patternsFound.push(`${currency} in table: ${rates.join(', ')}`);
            }
          }
        }
      });
    });
    
    // Estrategia 3: Buscar en inputs y elementos del formulario
    debugInfo.strategiesUsed.push('form-analysis');
    $('input, select, option').each((i, el) => {
      const $el = $(el);
      const value = $el.val();
      const text = $el.text();
      
      if (value && /^\d{1,2}\.\d{2,4}$/.test(value)) {
        const rate = parseFloat(value);
        if (rate > 15 && rate < 30) {
          debugInfo.patternsFound.push(`Form element rate: ${value}`);
        }
      }
    });
    
    // Estrategia 4: Regex agresivo en todo el HTML
    debugInfo.strategiesUsed.push('html-regex');
    const htmlText = html.replace(/<[^>]+>/g, ' '); // Remover tags HTML
    
    // Buscar patrones específicos para cada moneda
    const currencyPatterns = {
      USD: {
        regex: /USD[^\d]*(\d{1,2}\.\d{2,4})[^\d]*(\d{1,2}\.\d{2,4})/gi,
        range: [15, 25]
      },
      EUR: {
        regex: /EUR[^\d]*(\d{1,2}\.\d{2,4})[^\d]*(\d{1,2}\.\d{2,4})/gi,
        range: [18, 32]
      },
      CAD: {
        regex: /CAD[^\d]*(\d{1,2}\.\d{2,4})[^\d]*(\d{1,2}\.\d{2,4})/gi,
        range: [12, 16]
      },
      GBP: {
        regex: /GBP[^\d]*(\d{1,2}\.\d{2,4})[^\d]*(\d{1,2}\.\d{2,4})/gi,
        range: [20, 28]
      },
      JPY: {
        regex: /JPY[^\d]*(\d+\.\d{3,4})[^\d]*(\d+\.\d{3,4})/gi,
        range: [0.1, 0.2]
      }
    };
    
    Object.entries(currencyPatterns).forEach(([currency, pattern]) => {
      const match = pattern.regex.exec(htmlText);
      if (match) {
        const rate1 = parseFloat(match[1]);
        const rate2 = parseFloat(match[2]);
        
        if (rate1 >= pattern.range[0] && rate1 <= pattern.range[1] && 
            rate2 >= pattern.range[0] && rate2 <= pattern.range[1] && 
            rate1 !== rate2) {
          tasas[currency] = {
            compra: Math.min(rate1, rate2),
            venta: Math.max(rate1, rate2)
          };
          debugInfo.patternsFound.push(`${currency} HTML regex: ${rate1}, ${rate2}`);
        }
      }
    });
    
    // Estrategia 5: Buscar números sueltos que parezcan tasas
    debugInfo.strategiesUsed.push('loose-numbers');
    const allNumbers = htmlText.match(/\b\d{1,2}\.\d{2,4}\b/g);
    if (allNumbers) {
      const potentialUSDRates = allNumbers.map(n => parseFloat(n)).filter(n => n >= 16 && n <= 20);
      const potentialEURRates = allNumbers.map(n => parseFloat(n)).filter(n => n >= 19 && n <= 25);
      
      if (potentialUSDRates.length >= 2 && !tasas.USD) {
        potentialUSDRates.sort((a, b) => a - b);
        tasas.USD = { compra: potentialUSDRates[0], venta: potentialUSDRates[potentialUSDRates.length - 1] };
        debugInfo.patternsFound.push(`USD loose numbers: ${potentialUSDRates.join(', ')}`);
      }
      
      if (potentialEURRates.length >= 2 && !tasas.EUR) {
        potentialEURRates.sort((a, b) => a - b);
        tasas.EUR = { compra: potentialEURRates[0], venta: potentialEURRates[potentialEURRates.length - 1] };
        debugInfo.patternsFound.push(`EUR loose numbers: ${potentialEURRates.join(', ')}`);
      }
    }
    
    console.log('📊 Tasas extraídas:', tasas);
    console.log('🔍 Debug info:', debugInfo);
    
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

// Endpoint para análisis detallado de la página
app.get('/api/analyze', async (req, res) => {
  try {
    const analysis = await analizarHTMLDetallado();
    res.json({
      success: true,
      data: analysis,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint para análisis específico de conversión
app.get('/api/debug/:tipo/:moneda/:cantidad', async (req, res) => {
  try {
    const { tipo, moneda, cantidad } = req.params;
    console.log(`🐛 Debug mode para: ${tipo} ${cantidad} ${moneda}`);
    
    // Ejecutar ambos métodos y recolectar información detallada
    const debugInfo = {
      params: { tipo, moneda, cantidad: parseFloat(cantidad) },
      timestamp: new Date().toISOString(),
      ajax: null,
      reverseLogic: null,
      htmlAnalysis: null
    };
    
    // Probar simulación AJAX
    try {
      debugInfo.ajax = await simularCalculadoraAjax({ tipo, moneda, cantidad: parseFloat(cantidad) });
    } catch (ajaxError) {
      debugInfo.ajax = { error: ajaxError.message };
    }
    
    // Probar lógica reversa
    try {
      debugInfo.reverseLogic = await calcularConLogicaReversa({ tipo, moneda, cantidad: parseFloat(cantidad) });
    } catch (reverseError) {
      debugInfo.reverseLogic = { error: reverseError.message };
    }
    
    // Análisis del HTML
    try {
      debugInfo.htmlAnalysis = await analizarHTMLDetallado();
    } catch (htmlError) {
      debugInfo.htmlAnalysis = { error: htmlError.message };
    }
    
    res.json({
      success: true,
      data: debugInfo
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
    service: 'Banregio Currency API (Enhanced Ajax + Reverse Logic)',
    version: '2.1',
    descripcion: 'API mejorada para conversión de divisas desde Banregio con debugging avanzado',
    target: 'https://www.banregio.com/divisas.php',
    methods: ['Enhanced Ajax Simulation', 'Advanced Reverse Logic', 'Fallback Rates'],
    features: [
      'Múltiples estrategias de extracción',
      'Análisis profundo del HTML',
      'Debug detallado',
      'Cache inteligente',
      'Simulación AJAX avanzada'
    ],
    endpoints: [
      'GET  /api/health',
      'POST /api/convert',
      'GET  /api/convert/:tipo/:moneda/:cantidad',
      'GET  /api/rates',
      'GET  /api/analyze',
      'GET  /api/debug/:tipo/:moneda/:cantidad',
      'DELETE /api/cache',
      'GET  /api/currencies',
      'GET  /api/info'
    ],
    ejemplo: {
      conversion: '/api/convert/comprar/USD/500',
      debug: '/api/debug/comprar/USD/300',
      analyze: '/api/analyze',
      body: { tipo: 'comprar', moneda: 'USD', cantidad: 500 }
    },
    debugging: {
      description: 'Usa /api/debug/tipo/moneda/cantidad para diagnóstico detallado',
      analyze: 'Usa /api/analyze para análisis completo del HTML'
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
