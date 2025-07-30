const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
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

// Configuración robusta
const CONFIG = {
  timeouts: {
    navigation: 60000,
    selector: 15000,
    calculation: 20000
  },
  delays: {
    afterNavigation: 5000,
    afterClick: 2000,
    beforeCalculation: 1000,
    betweenRetries: 3000
  },
  maxRetries: 3
};

// Función de delay segura
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Función para cleanup seguro del browser
async function safeCloseBrowser(browser) {
  if (!browser) return;
  
  try {
    const pages = await browser.pages();
    for (const page of pages) {
      try {
        await page.close();
      } catch (e) {
        // Ignorar errores al cerrar páginas
      }
    }
    await browser.close();
  } catch (e) {
    try {
      // Forzar cierre si el método normal falla
      await browser.process()?.kill('SIGKILL');
    } catch (killError) {
      // Último recurso: matar procesos del sistema
      const { exec } = require('child_process');
      exec('taskkill /f /im chrome.exe', () => {});
      exec('pkill -f chrome', () => {});
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

// Función principal de conversión
async function convertirDivisa({ tipo = 'comprar', moneda = 'USD', cantidad = 300 }) {
  let browser = null;
  let page = null;
  
  try {
    // Configuración ultra-robusta del browser
    browser = await puppeteer.launch({
      headless: "new", // Usar nuevo modo headless para APIs
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
    });

    // Crear página con configuración robusta
    page = await browser.newPage();
    
    // Configurar página para máxima estabilidad
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.setDefaultTimeout(CONFIG.timeouts.selector);
    await page.setDefaultNavigationTimeout(CONFIG.timeouts.navigation);

    // Navegación ultra-robusta
    let navigationSuccess = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto('https://www.banregio.com/divisas.php#!', {
          waitUntil: ['networkidle0', 'domcontentloaded'],
          timeout: CONFIG.timeouts.navigation,
        });
        
        // Verificar que la página realmente cargó
        await delay(CONFIG.delays.afterNavigation);
        
        if (await isPageResponsive(page)) {
          navigationSuccess = true;
          break;
        } else {
          throw new Error('Página no responde después de cargar');
        }
        
      } catch (navError) {
        if (attempt === 3) throw navError;
        await delay(2000);
      }
    }

    if (!navigationSuccess) {
      throw new Error('No se pudo navegar a la página después de 3 intentos');
    }

    // Esperar elementos críticos
    await page.waitForFunction(() => {
      const texto = document.body.textContent.toLowerCase();
      return texto.includes('comprar') && texto.includes('vender');
    }, { timeout: CONFIG.timeouts.selector });

    // Hacer click en comprar/vender con método ultra-robusto
    const tipoTexto = tipo === 'comprar' ? 'comprar' : 'vender';
    
    const clickResult = await page.evaluate((tipoTexto) => {
      // Función para hacer click seguro
      function clickElement(element) {
        try {
          // Scroll al elemento si es necesario
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          
          // Múltiples métodos de click
          if (element.click) {
            element.click();
            return true;
          }
          
          // Dispatch click event
          const clickEvent = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true
          });
          element.dispatchEvent(clickEvent);
          return true;
          
        } catch (e) {
          return false;
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

    await delay(CONFIG.delays.afterClick);

    // Verificar que la página sigue respondiendo
    if (!(await isPageResponsive(page))) {
      throw new Error('La página dejó de responder después del click');
    }

    // Buscar e interactuar con selector de moneda
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
      }
    } catch (e) {
      // Continuar sin selector de moneda
    }

    await delay(CONFIG.delays.beforeCalculation);

    // Buscar e interactuar con campo de cantidad
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
    } else {
      throw new Error('No se encontró campo de cantidad');
    }

    // Esperar y obtener resultado con timeout extendido
    let resultado = null;
    const startTime = Date.now();
    
    while (!resultado && (Date.now() - startTime) < CONFIG.timeouts.calculation) {
      await delay(500);
      
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
          break;
        }
        
      } catch (e) {
        // Continuar intentando
      }
    }

    if (!resultado) {
      throw new Error('No se pudo obtener el resultado de la conversión después de esperar');
    }

    // Calcular tipo de cambio
    const mxn = resultado.value;
    const tipoCambio = mxn / cantidad;

    return {
      mxn: parseFloat(mxn.toFixed(2)),
      tipoCambio: parseFloat(tipoCambio.toFixed(4)),
      tipo,
      moneda,
      cantidad
    };

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
    if (reintentos < CONFIG.maxRetries) {
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
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Currency Conversion API'
  });
});

// Ruta principal de conversión
app.post('/api/convert', validateConversionParams, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { tipo = 'comprar', moneda = 'USD', cantidad = 300 } = req.body;
    
    console.log(`🔄 Iniciando conversión: ${tipo} ${cantidad} ${moneda}`);
    
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
        timestamp: new Date().toISOString()
      }
    });
    
    console.log(`✅ Conversión exitosa en ${processingTime}ms`);
    
  } catch (error) {
    const endTime = Date.now();
    const processingTime = endTime - startTime;
    
    console.error(`❌ Error en conversión: ${error.message}`);
    
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      message: error.message,
      meta: {
        processingTimeMs: processingTime,
        timestamp: new Date().toISOString()
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
        timestamp: new Date().toISOString()
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
        timestamp: new Date().toISOString()
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
  console.log(`🚀 API de Conversión de Divisas iniciada en puerto ${PORT}`);
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

module.exports = app;
