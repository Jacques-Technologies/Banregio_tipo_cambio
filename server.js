const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();

// ✅ SOLUCIÓN 1: CONFIGURAR TRUST PROXY PARA RENDER
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Rate limiting: máximo 10 requests por minuto por IP
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 10,
  message: {
    error: 'Demasiadas solicitudes, intenta nuevamente en un minuto'
  }
});

app.use('/api/', limiter);

// ✅ SOLUCIÓN 2: CONFIGURACIÓN PUPPETEER PARA RENDER
const getBrowserConfig = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (isProduction) {
    // Configuración específica para Render
    return {
      headless: "new",
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-dev-tools',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-web-security',
        '--disable-features=TranslateUI,VizDisplayCompositor',
        '--disable-extensions',
        '--disable-component-extensions-with-background-pages',
        '--disable-default-apps',
        '--disable-background-mode',
        '--force-device-scale-factor=1',
        '--window-size=1200,800',
        '--memory-pressure-off',
        '--max_old_space_size=4096',
        '--disable-ipc-flooding-protection',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-hang-monitor',
        '--disable-prompt-on-repost',
        '--disable-sync',
        '--metrics-recording-only',
        '--no-default-browser-check',
        '--safebrowsing-disable-auto-update',
        '--enable-automation',
        '--password-store=basic',
        '--use-mock-keychain'
      ],
      defaultViewport: { width: 1200, height: 800 },
      ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=IdleDetection'],
      timeout: 60000
    };
  } else {
    // Configuración para desarrollo local
    return {
      headless: "new",
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-dev-tools',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-web-security',
        '--disable-features=TranslateUI',
        '--disable-extensions',
        '--disable-component-extensions-with-background-pages',
        '--disable-default-apps',
        '--disable-background-mode',
        '--force-device-scale-factor=1',
        '--window-size=1200,800'
      ],
      defaultViewport: { width: 1200, height: 800 },
      ignoreDefaultArgs: ['--enable-automation'],
    };
  }
};

// Configuración robusta
const CONFIG = {
  timeouts: {
    navigation: 90000, // Aumentado para Render
    selector: 20000,   // Aumentado para Render
    calculation: 30000 // Aumentado para Render
  },
  delays: {
    afterNavigation: 6000, // Aumentado para Render
    afterClick: 3000,
    beforeCalculation: 2000,
    betweenRetries: 5000   // Aumentado para Render
  },
  maxRetries: 3
};

// Función de delay segura
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Función para cleanup seguro del browser
async function safeCloseBrowser(browser) {
  if (!browser) return;
  
  try {
    console.log('🧹 Iniciando cleanup del browser...');
    
    // Cerrar todas las páginas primero
    const pages = await browser.pages();
    for (const page of pages) {
      try {
        await page.close();
      } catch (e) {
        console.log('Error cerrando página:', e.message);
      }
    }
    
    // Cerrar el browser
    await browser.close();
    console.log('✅ Browser cerrado correctamente');
    
  } catch (e) {
    console.log('❌ Error en cierre normal, intentando forzar cierre...');
    try {
      // Forzar cierre si el método normal falla
      if (browser.process()) {
        browser.process().kill('SIGKILL');
        console.log('✅ Browser forzado a cerrar con SIGKILL');
      }
    } catch (killError) {
      console.log('❌ Error en cierre forzado:', killError.message);
      
      // Último recurso para sistemas Unix/Linux (como Render)
      if (process.platform !== 'win32') {
        try {
          const { exec } = require('child_process');
          exec('pkill -f "chrome\\|chromium"', (error, stdout, stderr) => {
            if (error) {
              console.log('Error ejecutando pkill:', error.message);
            } else {
              console.log('✅ Procesos Chrome/Chromium terminados con pkill');
            }
          });
        } catch (execError) {
          console.log('Error ejecutando comando del sistema:', execError.message);
        }
      }
    }
  }
}

// Función para detectar si la página está disponible
async function isPageResponsive(page) {
  try {
    await page.evaluate(() => document.title);
    return true;
  } catch (e) {
    return false;
  }
}

// Función para verificar si Puppeteer está disponible
async function checkPuppeteerAvailability() {
  try {
    const browserConfig = getBrowserConfig();
    const browser = await puppeteer.launch(browserConfig);
    await browser.close();
    return true;
  } catch (error) {
    console.error('❌ Puppeteer no está disponible:', error.message);
    return false;
  }
}

// Función principal de conversión
async function convertirDivisa({ tipo = 'comprar', moneda = 'USD', cantidad = 300 }) {
  let browser = null;
  let page = null;
  
  try {
    console.log(`🚀 Iniciando conversión: ${tipo} ${cantidad} ${moneda}`);
    
    // Obtener configuración del browser para el entorno actual
    const browserConfig = getBrowserConfig();
    console.log('🔧 Configuración del browser:', {
      isProduction: process.env.NODE_ENV === 'production',
      executablePath: browserConfig.executablePath || 'default',
      argsCount: browserConfig.args.length
    });
    
    // Lanzar browser con configuración robusta
    browser = await puppeteer.launch(browserConfig);
    console.log('✅ Browser lanzado correctamente');

    // Crear página con configuración robusta
    page = await browser.newPage();
    console.log('✅ Nueva página creada');
    
    // Configurar página para máxima estabilidad
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36');
    await page.setDefaultTimeout(CONFIG.timeouts.selector);
    await page.setDefaultNavigationTimeout(CONFIG.timeouts.navigation);
    
    // Configuraciones adicionales para estabilidad
    await page.setViewport({ width: 1200, height: 800 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });

    console.log('✅ Página configurada');

    // Navegación ultra-robusta con reintentos
    let navigationSuccess = false;
    const maxNavAttempts = 3;
    
    for (let attempt = 1; attempt <= maxNavAttempts; attempt++) {
      try {
        console.log(`🌐 Intento de navegación ${attempt}/${maxNavAttempts}...`);
        
        await page.goto('https://www.banregio.com/divisas.php#!', {
          waitUntil: ['networkidle0', 'domcontentloaded'],
          timeout: CONFIG.timeouts.navigation,
        });
        
        console.log('✅ Navegación inicial completada');
        
        // Verificar que la página realmente cargó
        await delay(CONFIG.delays.afterNavigation);
        
        if (await isPageResponsive(page)) {
          console.log('✅ Página responde correctamente');
          navigationSuccess = true;
          break;
        } else {
          throw new Error('Página no responde después de cargar');
        }
        
      } catch (navError) {
        console.log(`❌ Intento de navegación ${attempt} falló:`, navError.message);
        if (attempt === maxNavAttempts) {
          throw new Error(`No se pudo navegar después de ${maxNavAttempts} intentos: ${navError.message}`);
        }
        await delay(CONFIG.delays.betweenRetries);
      }
    }

    if (!navigationSuccess) {
      throw new Error('No se pudo navegar a la página después de todos los intentos');
    }

    // Esperar elementos críticos de la página
    console.log('🔍 Esperando elementos críticos...');
    await page.waitForFunction(() => {
      const texto = document.body.textContent.toLowerCase();
      return texto.includes('comprar') && texto.includes('vender');
    }, { timeout: CONFIG.timeouts.selector });
    
    console.log('✅ Elementos críticos encontrados');

    // Hacer click en comprar/vender con método ultra-robusto
    const tipoTexto = tipo === 'comprar' ? 'comprar' : 'vender';
    console.log(`🖱️ Haciendo click en "${tipoTexto}"...`);
    
    const clickResult = await page.evaluate((tipoTexto) => {
      // Función para hacer click seguro
      function clickElement(element) {
        try {
          // Scroll al elemento si es necesario
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          
          // Esperar un poco después del scroll
          return new Promise((resolve) => {
            setTimeout(() => {
              try {
                // Múltiples métodos de click
                if (element.click) {
                  element.click();
                  resolve(true);
                  return;
                }
                
                // Dispatch click event
                const clickEvent = new MouseEvent('click', {
                  view: window,
                  bubbles: true,
                  cancelable: true
                });
                element.dispatchEvent(clickEvent);
                resolve(true);
                
              } catch (e) {
                resolve(false);
              }
            }, 500);
          });
        } catch (e) {
          return Promise.resolve(false);
        }
      }
      
      // Buscar elementos que contengan el texto
      const allElements = document.querySelectorAll('*');
      const candidates = [];
      
      for (let element of allElements) {
        const text = element.textContent ? element.textContent.trim().toLowerCase() : '';
        
        if (text.includes(tipoTexto) && text.length < 100) {
          candidates.push({
            element: element,
            text: text,
            clickable: element.tagName === 'BUTTON' || 
                      element.tagName === 'A' || 
                      element.onclick || 
                      window.getComputedStyle(element).cursor === 'pointer'
          });
        }
      }
      
      // Priorizar elementos clickeables
      candidates.sort((a, b) => b.clickable - a.clickable);
      
      // Intentar click en los mejores candidatos
      for (let candidate of candidates.slice(0, 5)) {
        if (clickElement(candidate.element)) {
          return `Click exitoso en: ${candidate.text.substring(0, 30)}`;
        }
      }
      
      return 'No se pudo hacer click';
    }, tipoTexto);

    console.log('✅ Resultado del click:', clickResult);
    await delay(CONFIG.delays.afterClick);

    // Verificar que la página sigue respondiendo
    if (!(await isPageResponsive(page))) {
      throw new Error('La página dejó de responder después del click');
    }

    // Buscar e interactuar con selector de moneda
    console.log('💱 Configurando moneda...');
    try {
      // Buscar selector de moneda de forma robusta
      const selectorFound = await page.waitForFunction(() => {
        const selectors = document.querySelectorAll('select, .custom-select');
        return selectors.length > 0;
      }, { timeout: CONFIG.timeouts.selector });
      
      if (selectorFound) {
        await page.evaluate((moneda) => {
          const selectors = document.querySelectorAll('select, .custom-select');
          for (let selector of selectors) {
            try {
              selector.value = moneda;
              selector.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (e) {
              continue;
            }
          }
        }, moneda);
        console.log(`✅ Moneda configurada: ${moneda}`);
      }
    } catch (e) {
      console.log('⚠️ No se encontró selector de moneda, continuando...');
    }

    await delay(CONFIG.delays.beforeCalculation);

    // Buscar e interactuar con campo de cantidad
    console.log('🔢 Configurando cantidad...');
    const quantityInputFound = await page.waitForFunction(() => {
      const inputs = document.querySelectorAll('input[type="text"], input[type="number"], input:not([type])');
      for (let input of inputs) {
        if (input.id === 'divisa' || 
            input.placeholder?.toLowerCase().includes('cantidad') ||
            input.placeholder?.toLowerCase().includes('usd') ||
            input.placeholder?.toLowerCase().includes('eur')) {
          return true;
        }
      }
      return false;
    }, { timeout: CONFIG.timeouts.selector });

    if (quantityInputFound) {
      await page.evaluate((cantidad) => {
        const inputs = document.querySelectorAll('input[type="text"], input[type="number"], input:not([type])');
        
        for (let input of inputs) {
          if (input.id === 'divisa' || 
              input.placeholder?.toLowerCase().includes('cantidad') ||
              input.placeholder?.toLowerCase().includes('usd') ||
              input.placeholder?.toLowerCase().includes('eur')) {
            
            // Limpiar y establecer valor
            input.focus();
            input.value = '';
            input.value = cantidad.toString();
            
            // Disparar todos los eventos posibles
            const events = ['input', 'change', 'keyup', 'keydown', 'blur', 'focusout'];
            events.forEach(eventType => {
              try {
                input.dispatchEvent(new Event(eventType, { bubbles: true }));
              } catch (e) {}
            });
            
            break;
          }
        }
      }, cantidad);
      
      console.log(`✅ Cantidad configurada: ${cantidad}`);
    } else {
      throw new Error('No se encontró campo de cantidad');
    }

    // Esperar y obtener resultado con timeout extendido
    console.log('⏳ Esperando resultado del cálculo...');
    let resultado = null;
    const startTime = Date.now();
    
    while (!resultado && (Date.now() - startTime) < CONFIG.timeouts.calculation) {
      await delay(1000); // Aumentado el delay entre verificaciones
      
      if (!(await isPageResponsive(page))) {
        throw new Error('La página dejó de responder durante el cálculo');
      }
      
      try {
        resultado = await page.evaluate(() => {
          // Buscar múltiples campos posibles para el resultado
          const possibleFields = [
            '#mxn',
            'input[placeholder*="mxn"]',
            'input[placeholder*="MXN"]',
            'input[placeholder*="peso"]',
            'input[placeholder*="resultado"]'
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
          
          // Buscar en todos los inputs numéricos como fallback
          const allInputs = document.querySelectorAll('input');
          for (let input of allInputs) {
            if (input.value && input.value !== '' && input.value !== '0') {
              const value = parseFloat(input.value.replace(/[,$]/g, ''));
              if (!isNaN(value) && value > 50) { // Asumir que conversiones son > 50
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
        // Continuar intentando
        console.log('⏳ Esperando resultado...');
      }
    }

    if (!resultado) {
      throw new Error('No se pudo obtener el resultado de la conversión después de esperar');
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
      fuente: 'banregio-puppeteer',
      timestamp: new Date().toISOString()
    };
    
    console.log('🎉 Conversión completada:', resultadoFinal);
    return resultadoFinal;

  } catch (error) {
    console.error('❌ Error en convertirDivisa:', error.message);
    throw error;
  } finally {
    // Cleanup ultra-seguro
    await safeCloseBrowser(browser);
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
  
  // Validar tipo
  if (tipo && !['comprar', 'vender'].includes(tipo)) {
    return res.status(400).json({
      error: 'Tipo debe ser "comprar" o "vender"'
    });
  }
  
  // Validar moneda
  if (moneda && !['USD', 'EUR', 'CAD', 'GBP', 'JPY'].includes(moneda)) {
    return res.status(400).json({
      error: 'Moneda debe ser una de: USD, EUR, CAD, GBP, JPY'
    });
  }
  
  // Validar cantidad
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
    service: 'Currency Conversion API (Puppeteer)',
    version: '2.0',
    environment: process.env.NODE_ENV || 'development',
    puppeteer: 'checking...'
  };
  
  // Verificar disponibilidad de Puppeteer
  try {
    const puppeteerAvailable = await checkPuppeteerAvailability();
    healthCheck.puppeteer = puppeteerAvailable ? 'available' : 'not available';
    healthCheck.status = puppeteerAvailable ? 'OK' : 'WARNING';
  } catch (error) {
    healthCheck.puppeteer = `error: ${error.message}`;
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

// Ruta GET simplificada para conversiones rápidas
app.get('/api/convert/:tipo/:moneda/:cantidad', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { tipo, moneda, cantidad } = req.params;
    
    // Validaciones básicas
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

// Ruta para obtener todas las monedas soportadas
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
  console.log(`🚀 API de Conversión de Divisas (Puppeteer) iniciada en puerto ${PORT}`);
  console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📍 Endpoints disponibles:`);
  console.log(`   GET  http://localhost:${PORT}/api/health`);
  console.log(`   POST http://localhost:${PORT}/api/convert`);
  console.log(`   GET  http://localhost:${PORT}/api/convert/:tipo/:moneda/:cantidad`);
  console.log(`   GET  http://localhost:${PORT}/api/currencies`);
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
