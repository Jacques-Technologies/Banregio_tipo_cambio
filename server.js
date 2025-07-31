const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();

// ✅ CONFIGURAR TRUST PROXY PARA RENDER
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Rate limiting: máximo 10 requests por minuto por IP
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: {
    error: 'Demasiadas solicitudes, intenta nuevamente en un minuto'
  }
});

app.use('/api/', limiter);

// ✅ CONFIGURACIÓN PLAYWRIGHT PARA PRODUCCIÓN
const getBrowserConfig = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (isProduction) {
    return {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=TranslateUI,VizDisplayCompositor',
        '--disable-extensions',
        '--disable-default-apps',
        '--disable-background-mode',
        '--force-device-scale-factor=1',
        '--memory-pressure-off',
        '--max_old_space_size=4096',
        '--disable-background-networking',
        '--disable-hang-monitor',
        '--disable-prompt-on-repost',
        '--disable-sync',
        '--no-default-browser-check',
        '--enable-automation',
        '--password-store=basic',
        '--use-mock-keychain'
      ],
      ignoreDefaultArgs: ['--enable-automation'],
      timeout: 60000
    };
  } else {
    return {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ],
      timeout: 30000
    };
  }
};

// Configuración robusta
const CONFIG = {
  timeouts: {
    navigation: 90000,
    selector: 20000,
    calculation: 30000
  },
  delays: {
    afterNavigation: 6000,
    afterClick: 3000,
    beforeCalculation: 2000,
    betweenRetries: 5000
  },
  maxRetries: 3
};

// Función de delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Función para cleanup seguro del browser
async function safeCloseBrowser(browser, context) {
  try {
    console.log('🧹 Iniciando cleanup...');
    
    if (context) {
      await context.close();
      console.log('✅ Contexto cerrado');
    }
    
    if (browser) {
      await browser.close();
      console.log('✅ Browser cerrado');
    }
    
  } catch (e) {
    console.log('❌ Error en cleanup:', e.message);
    try {
      if (browser) {
        await browser.close();
      }
    } catch (killError) {
      console.log('❌ Error forzando cierre:', killError.message);
    }
  }
}

// Función principal de conversión con Playwright
async function convertirDivisa({ tipo = 'comprar', moneda = 'USD', cantidad = 300 }) {
  let browser = null;
  let context = null;
  let page = null;
  
  try {
    console.log(`🚀 Initiando conversión Playwright: ${tipo} ${cantidad} ${moneda}`);
    
    // Lanzar browser con configuración robusta
    const browserConfig = getBrowserConfig();
    browser = await chromium.launch(browserConfig);
    
    // Crear contexto con configuración específica
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1200, height: 800 },
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true
    });
    
    // Crear página
    page = await context.newPage();
    
    // Configuraciones adicionales
    await page.setDefaultTimeout(CONFIG.timeouts.selector);
    await page.setDefaultNavigationTimeout(CONFIG.timeouts.navigation);
    
    console.log('✅ Browser y página configurados');

    // Navegación ultra-robusta con reintentos
    let navigationSuccess = false;
    const maxNavAttempts = 3;
    
    for (let attempt = 1; attempt <= maxNavAttempts; attempt++) {
      try {
        console.log(`🌐 Intento de navegación ${attempt}/${maxNavAttempts}...`);
        
        await page.goto('https://www.banregio.com/divisas.php#!', {
          waitUntil: 'networkidle',
          timeout: CONFIG.timeouts.navigation,
        });
        
        console.log('✅ Navegación inicial completada');
        
        // Verificar que la página cargó correctamente
        await delay(CONFIG.delays.afterNavigation);
        
        const pageLoaded = await page.evaluate(() => {
          const texto = document.body.textContent.toLowerCase();
          return texto.includes('comprar') && texto.includes('vender');
        });
        
        if (pageLoaded) {
          console.log('✅ Página verificada correctamente');
          navigationSuccess = true;
          break;
        } else {
          throw new Error('Página no contiene elementos esperados');
        }
        
      } catch (navError) {
        console.log(`❌ Intento ${attempt} falló:`, navError.message);
        if (attempt === maxNavAttempts) {
          throw new Error(`Navegación falló después de ${maxNavAttempts} intentos: ${navError.message}`);
        }
        await delay(CONFIG.delays.betweenRetries);
      }
    }

    if (!navigationSuccess) {
      throw new Error('No se pudo navegar después de todos los intentos');
    }

    // Esperar elementos críticos
    console.log('🔍 Esperando elementos críticos...');
    await page.waitForFunction(() => {
      const texto = document.body.textContent.toLowerCase();
      return texto.includes('comprar') && texto.includes('vender');
    }, { timeout: CONFIG.timeouts.selector });

    // Hacer click en comprar/vender con método ultra-robusto
    const tipoTexto = tipo === 'comprar' ? 'comprar' : 'vender';
    console.log(`🖱️ Haciendo click en "${tipoTexto}"...`);
    
    // Buscar y hacer click usando Playwright
    const clickSuccess = await page.evaluate((tipoTexto) => {
      const allElements = Array.from(document.querySelectorAll('*'));
      
      for (let element of allElements) {
        const text = element.textContent ? element.textContent.trim().toLowerCase() : '';
        
        if (text.includes(tipoTexto) && text.length < 100) {
          try {
            // Scroll al elemento
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Hacer click
            element.click();
            return `Click exitoso en: ${text.substring(0, 30)}`;
          } catch (e) {
            continue;
          }
        }
      }
      return null;
    }, tipoTexto);

    if (!clickSuccess) {
      // Fallback: usar selector más específico
      try {
        await page.locator(`text=${tipoTexto}`).first().click();
        console.log(`✅ Click fallback exitoso en "${tipoTexto}"`);
      } catch (e) {
        throw new Error(`No se pudo hacer click en "${tipoTexto}"`);
      }
    } else {
      console.log('✅', clickSuccess);
    }

    await delay(CONFIG.delays.afterClick);

    // Configurar moneda
    console.log('💱 Configurando moneda...');
    try {
      // Buscar selector de moneda
      const selectorFound = await page.locator('select').first().isVisible({ timeout: 5000 });
      
      if (selectorFound) {
        await page.locator('select').first().selectOption(moneda);
        console.log(`✅ Moneda configurada: ${moneda}`);
      } else {
        console.log('⚠️ No se encontró selector de moneda');
      }
    } catch (e) {
      console.log('⚠️ Error configurando moneda:', e.message);
    }

    await delay(CONFIG.delays.beforeCalculation);

    // Configurar cantidad
    console.log('🔢 Configurando cantidad...');
    
    // Buscar campo de cantidad
    const quantitySelectors = [
      '#divisa',
      'input[placeholder*="cantidad" i]',
      'input[placeholder*="usd" i]',
      'input[placeholder*="eur" i]',
      'input[type="text"]',
      'input[type="number"]',
      'input:not([type])'
    ];
    
    let quantityInput = null;
    for (const selector of quantitySelectors) {
      try {
        quantityInput = page.locator(selector).first();
        if (await quantityInput.isVisible({ timeout: 2000 })) {
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    if (quantityInput) {
      await quantityInput.click();
      await quantityInput.fill('');
      await quantityInput.fill(cantidad.toString());
      await quantityInput.press('Enter');
      console.log(`✅ Cantidad configurada: ${cantidad}`);
    } else {
      throw new Error('No se encontró campo de cantidad');
    }

    // Esperar y obtener resultado
    console.log('⏳ Esperando resultado del cálculo...');
    let resultado = null;
    const startTime = Date.now();
    
    while (!resultado && (Date.now() - startTime) < CONFIG.timeouts.calculation) {
      await delay(1000);
      
      try {
        resultado = await page.evaluate(() => {
          const possibleFields = [
            '#mxn',
            'input[placeholder*="mxn" i]',
            'input[placeholder*="peso" i]',
            'input[placeholder*="resultado" i]'
          ];
          
          for (let selector of possibleFields) {
            const field = document.querySelector(selector);
            if (field && field.value && field.value !== '' && field.value !== '0') {
              const value = parseFloat(field.value.replace(/[,$]/g, ''));
              if (!isNaN(value) && value > 0) {
                return {
                  value: value,
                  source: selector,
                  rawValue: field.value
                };
              }
            }
          }
          
          // Fallback: buscar en todos los inputs
          const allInputs = document.querySelectorAll('input');
          for (let input of allInputs) {
            if (input.value && input.value !== '' && input.value !== '0') {
              const value = parseFloat(input.value.replace(/[,$]/g, ''));
              if (!isNaN(value) && value > 50) {
                return {
                  value: value,
                  source: 'fallback',
                  rawValue: input.value
                };
              }
            }
          }
          
          return null;
        });
        
        if (resultado) {
          console.log('✅ Resultado obtenido:', resultado);
          break;
        }
        
      } catch (e) {
        console.log('⏳ Esperando resultado...');
      }
    }

    if (!resultado) {
      throw new Error('No se pudo obtener el resultado después de esperar');
    }

    // Calcular tipo de cambio
    const mxn = resultado.value;
    const tipoCambio = mxn / cantidad;

    const resultadoFinal = {
      mxn: parseFloat(mxn.toFixed(2)),
      tipoCambio: parseFloat(tipoCambio.toFixed(4)),
      tipo,
      moneda,
      cantidad,
      fuente: 'banregio-playwright',
      timestamp: new Date().toISOString()
    };
    
    console.log('🎉 Conversión completada:', resultadoFinal);
    return resultadoFinal;

  } catch (error) {
    console.error('❌ Error en convertirDivisa:', error.message);
    throw error;
  } finally {
    await safeCloseBrowser(browser, context);
  }
}

// Función con retry automático
async function convertirDivisaConRetry(params, reintentos = 0) {
  try {
    return await convertirDivisa(params);
  } catch (error) {
    console.error(`❌ Intento ${reintentos + 1} falló:`, error.message);
    
    if (reintentos < CONFIG.maxRetries) {
      console.log(`🔄 Reintentando en ${CONFIG.delays.betweenRetries}ms...`);
      await delay(CONFIG.delays.betweenRetries);
      return await convertirDivisaConRetry(params, reintentos + 1);
    } else {
      throw new Error(`Falló después de ${CONFIG.maxRetries + 1} intentos: ${error.message}`);
    }
  }
}

// Middleware de validación
function validateConversionParams(req, res, next) {
  const { tipo, moneda, cantidad } = req.body;
  
  if (tipo && !['comprar', 'vender'].includes(tipo)) {
    return res.status(400).json({
      error: 'Tipo debe ser "comprar" o "vender"'
    });
  }
  
  if (moneda && !['USD', 'EUR', 'CAD', 'GBP', 'JPY'].includes(moneda)) {
    return res.status(400).json({
      error: 'Moneda debe ser una de: USD, EUR, CAD, GBP, JPY'
    });
  }
  
  if (cantidad && (isNaN(cantidad) || cantidad <= 0 || cantidad > 100000)) {
    return res.status(400).json({
      error: 'Cantidad debe ser un número positivo menor a 100,000'
    });
  }
  
  next();
}

// RUTAS DE LA API

// Ruta de salud
app.get('/api/health', async (req, res) => {
  const healthCheck = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Banregio Currency API (Playwright)',
    version: '2.0',
    environment: process.env.NODE_ENV || 'development',
    playwright: 'checking...'
  };
  
  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    healthCheck.playwright = 'available';
  } catch (error) {
    healthCheck.playwright = `error: ${error.message}`;
    healthCheck.status = 'ERROR';
  }
  
  res.json(healthCheck);
});

// Ruta principal de conversión
app.post('/api/convert', validateConversionParams, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { tipo = 'comprar', moneda = 'USD', cantidad = 300 } = req.body;
    
    console.log(`🔄 Iniciando conversión POST: ${tipo} ${cantidad} ${moneda}`);
    
    const resultado = await convertirDivisaConRetry({
      tipo,
      moneda,
      cantidad: parseFloat(cantidad)
    });
    
    const endTime = Date.now();
    const processingTime = endTime - startTime;
    
    res.json({
      success: true,
      data: resultado,
      meta: {
        processingTimeMs: processingTime,
        timestamp: new Date().toISOString(),
        method: 'POST'
      }
    });
    
    console.log(`✅ Conversión POST exitosa en ${processingTime}ms`);
    
  } catch (error) {
    const endTime = Date.now();
    const processingTime = endTime - startTime;
    
    console.error(`❌ Error en conversión POST: ${error.message}`);
    
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      message: error.message,
      meta: {
        processingTimeMs: processingTime,
        timestamp: new Date().toISOString(),
        method: 'POST'
      }
    });
  }
});

// Ruta GET
app.get('/api/convert/:tipo/:moneda/:cantidad', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { tipo, moneda, cantidad } = req.params;
    
    // Validaciones
    if (!['comprar', 'vender'].includes(tipo)) {
      return res.status(400).json({
        success: false,
        error: 'Tipo debe ser "comprar" o "vender"'
      });
    }
    
    if (!['USD', 'EUR', 'CAD', 'GBP', 'JPY'].includes(moneda)) {
      return res.status(400).json({
        success: false,
        error: 'Moneda debe ser una de: USD, EUR, CAD, GBP, JPY'
      });
    }
    
    const cantidadNum = parseFloat(cantidad);
    if (isNaN(cantidadNum) || cantidadNum <= 0 || cantidadNum > 100000) {
      return res.status(400).json({
        success: false,
        error: 'Cantidad debe ser un número positivo menor a 100,000'
      });
    }
    
    console.log(`🔄 Iniciando conversión GET: ${tipo} ${cantidadNum} ${moneda}`);
    
    const resultado = await convertirDivisaConRetry({
      tipo,
      moneda,
      cantidad: cantidadNum
    });
    
    const endTime = Date.now();
    const processingTime = endTime - startTime;
    
    res.json({
      success: true,
      data: resultado,
      meta: {
        processingTimeMs: processingTime,
        timestamp: new Date().toISOString(),
        method: 'GET'
      }
    });
    
    console.log(`✅ Conversión GET exitosa en ${processingTime}ms`);
    
  } catch (error) {
    const endTime = Date.now();
    const processingTime = endTime - startTime;
    
    console.error(`❌ Error en conversión GET: ${error.message}`);
    
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      message: error.message,
      meta: {
        processingTimeMs: processingTime,
        timestamp: new Date().toISOString(),
        method: 'GET'
      }
    });
  }
});

// Ruta para obtener monedas soportadas
app.get('/api/currencies', (req, res) => {
  res.json({
    success: true,
    data: {
      supported: ['USD', 'EUR', 'CAD', 'GBP', 'JPY'],
      types: ['comprar', 'vender']
    }
  });
});

// Manejo de rutas no encontradas
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Ruta no encontrada',
    availableEndpoints: [
      'GET /api/health',
      'POST /api/convert',
      'GET /api/convert/:tipo/:moneda/:cantidad',
      'GET /api/currencies'
    ]
  });
});

// Manejo global de errores
app.use((error, req, res, next) => {
  console.error('Error no manejado:', error);
  res.status(500).json({
    success: false,
    error: 'Error interno del servidor'
  });
});

// Iniciar servidor
const server = app.listen(PORT, () => {
  console.log(`🚀 API Banregio (Playwright) iniciada en puerto ${PORT}`);
  console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🎯 Objetivo: https://www.banregio.com/divisas.php#!`);
  console.log(`📍 Endpoints:`);
  console.log(`   GET  /api/health`);
  console.log(`   POST /api/convert`);
  console.log(`   GET  /api/convert/:tipo/:moneda/:cantidad`);
});

// Manejo de cierre graceful
process.on('SIGTERM', () => {
  console.log('🛑 Cerrando servidor...');
  server.close(() => {
    console.log('✅ Servidor cerrado correctamente');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 Cerrando servidor...');
  server.close(() => {
    console.log('✅ Servidor cerrado correctamente');
    process.exit(0);
  });
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
  console.error('❌ Excepción no capturada:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promesa rechazada no manejada:', reason);
  process.exit(1);
});

module.exports = app;
