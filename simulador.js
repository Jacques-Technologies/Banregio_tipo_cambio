// ===== ESTRATEGIA 1: BROWSER POOL =====
// browser-pool.js
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

class BrowserPool {
  constructor(maxBrowsers = 3) {
    this.maxBrowsers = maxBrowsers;
    this.browsers = [];
    this.busyBrowsers = new Set();
    this.queue = [];
  }

  async initialize() {
    console.log(`🔧 Inicializando pool de ${this.maxBrowsers} browsers...`);
    
    for (let i = 0; i < this.maxBrowsers; i++) {
      const browser = await this.createBrowser();
      this.browsers.push(browser);
    }
    
    console.log(`✅ Pool inicializado con ${this.browsers.length} browsers`);
  }

  async createBrowser() {
    const executablePath = await chromium.executablePath();
    
    return await puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: executablePath,
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });
  }

  async getBrowser() {
    return new Promise((resolve) => {
      // Buscar browser disponible
      const availableBrowser = this.browsers.find(browser => 
        !this.busyBrowsers.has(browser)
      );

      if (availableBrowser) {
        this.busyBrowsers.add(availableBrowser);
        resolve(availableBrowser);
      } else {
        // Agregar a cola si no hay browsers disponibles
        this.queue.push(resolve);
      }
    });
  }

  releaseBrowser(browser) {
    this.busyBrowsers.delete(browser);
    
    // Procesar cola si hay requests esperando
    if (this.queue.length > 0) {
      const nextRequest = this.queue.shift();
      this.busyBrowsers.add(browser);
      nextRequest(browser);
    }
  }

  async close() {
    console.log('🔒 Cerrando pool de browsers...');
    await Promise.all(this.browsers.map(browser => browser.close()));
    this.browsers = [];
    this.busyBrowsers.clear();
  }
}

// ===== ESTRATEGIA 2: SIMULADOR OPTIMIZADO CON POOL =====
// simulador-optimizado.js
const browserPool = new BrowserPool(3); // Máximo 3 browsers simultáneos

// Inicializar pool al arrancar la aplicación
let poolInitialized = false;

async function initializePool() {
  if (!poolInitialized) {
    await browserPool.initialize();
    poolInitialized = true;
  }
}

async function simularConvertToMXNOptimizado(moneda = 'USD', cantidad = 100, tipoOperacion = 'compra') {
  await initializePool();
  
  const browser = await browserPool.getBrowser();
  let page = null;

  try {
    console.log(`🚀 Procesando: ${tipoOperacion} ${cantidad} ${moneda}`);
    
    page = await browser.newPage();
    
    // Configurar User-Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    // Navegación más rápida - solo esperar DOMContentLoaded
    await page.goto('https://www.banregio.com/divisas.php', {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });

    // Seleccionar elementos en paralelo donde sea posible
    await Promise.all([
      page.waitForSelector('#divisa', { timeout: 10000 }),
      page.waitForSelector('.custom-select', { timeout: 10000 }),
      page.waitForSelector('#mxn', { timeout: 10000 })
    ]);

    // Operaciones secuenciales necesarias
    await page.select('.custom-select', moneda);
    
    await page.focus('#divisa');
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.type('#divisa', String(cantidad), { delay: 30 }); // Menos delay

    const selectorOperacion = tipoOperacion === 'compra' ? '#opcCompra' : '#opcVenta';
    await page.click(selectorOperacion);

    // Esperar resultado con timeout más corto
    await page.waitForFunction(() => {
      const el = document.querySelector('#mxn');
      return el && parseFloat(el.value) > 0;
    }, { timeout: 8000 });

    const mxn = await page.$eval('#mxn', el => el.value);
    const tipoCambio = (parseFloat(mxn) / cantidad).toFixed(4);

    console.log(`✅ Completado: ${cantidad} ${moneda} = ${mxn} MXN`);

    return {
      success: true,
      moneda,
      cantidad: parseFloat(cantidad),
      tipoOperacion,
      mxn: parseFloat(mxn),
      tipoCambio: parseFloat(tipoCambio),
      fuente: 'https://www.banregio.com/divisas.php',
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error(`❌ Error procesando ${tipoOperacion} ${cantidad} ${moneda}:`, error.message);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  } finally {
    // Cerrar página pero mantener browser
    if (page) {
      await page.close();
    }
    // Liberar browser para próximo request
    browserPool.releaseBrowser(browser);
  }
}

// ===== ESTRATEGIA 3: CACHE CON REDIS/MEMORIA =====
// cache-manager.js
class CacheManager {
  constructor(ttlMinutes = 2) { // Cache por 2 minutos
    this.cache = new Map();
    this.ttlMs = ttlMinutes * 60 * 1000;
  }

  getKey(moneda, tipoOperacion) {
    return `${moneda}-${tipoOperacion}`;
  }

  get(moneda, tipoOperacion) {
    const key = this.getKey(moneda, tipoOperacion);
    const cached = this.cache.get(key);
    
    if (!cached) return null;
    
    // Verificar si expiró
    if (Date.now() - cached.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    
    return cached.data;
  }

  set(moneda, tipoOperacion, tipoCambio) {
    const key = this.getKey(moneda, tipoOperacion);
    this.cache.set(key, {
      data: tipoCambio,
      timestamp: Date.now()
    });
  }

  // Limpiar cache expirado periódicamente
  cleanup() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }
}

const cache = new CacheManager(2); // 2 minutos de cache

// Limpiar cache cada 5 minutos
setInterval(() => cache.cleanup(), 5 * 60 * 1000);

async function simularConvertToMXNConCache(moneda, cantidad, tipoOperacion) {
  // Intentar obtener tipo de cambio del cache
  const cachedRate = cache.get(moneda, tipoOperacion);
  
  if (cachedRate) {
    console.log(`💾 Usando tipo de cambio cacheado: ${cachedRate}`);
    const mxn = cantidad * cachedRate;
    
    return {
      success: true,
      moneda,
      cantidad: parseFloat(cantidad),
      tipoOperacion,
      mxn: parseFloat(mxn.toFixed(2)),
      tipoCambio: cachedRate,
      fuente: 'https://www.banregio.com/divisas.php',
      cached: true,
      timestamp: new Date().toISOString()
    };
  }

  // Si no está en cache, hacer scraping
  const result = await simularConvertToMXNOptimizado(moneda, cantidad, tipoOperacion);
  
  if (result.success) {
    // Guardar tipo de cambio en cache
    cache.set(moneda, tipoOperacion, result.tipoCambio);
  }
  
  return result;
}

// ===== ESTRATEGIA 4: QUEUE SYSTEM =====
// queue-manager.js
class QueueManager {
  constructor(concurrency = 3) {
    this.concurrency = concurrency;
    this.queue = [];
    this.running = 0;
  }

  async add(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        task,
        resolve,
        reject
      });
      this.process();
    });
  }

  async process() {
    if (this.running >= this.concurrency || this.queue.length === 0) {
      return;
    }

    this.running++;
    const { task, resolve, reject } = this.queue.shift();

    try {
      const result = await task();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.running--;
      this.process(); // Procesar siguiente en cola
    }
  }
}

const queue = new QueueManager(3); // Máximo 3 requests simultáneos

async function simularConvertToMXNConQueue(moneda, cantidad, tipoOperacion) {
  return queue.add(() => simularConvertToMXNConCache(moneda, cantidad, tipoOperacion));
}

// ===== ESTRATEGIA 5: RATE LIMITING =====
// rate-limiter.js
class RateLimiter {
  constructor(maxRequests = 10, windowMs = 60000) { // 10 requests por minuto
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = new Map();
  }

  isAllowed(ip) {
    const now = Date.now();
    const userRequests = this.requests.get(ip) || [];
    
    // Filtrar requests dentro de la ventana de tiempo
    const recentRequests = userRequests.filter(time => now - time < this.windowMs);
    
    if (recentRequests.length >= this.maxRequests) {
      return false;
    }
    
    // Agregar request actual
    recentRequests.push(now);
    this.requests.set(ip, recentRequests);
    
    return true;
  }

  cleanup() {
    const now = Date.now();
    for (const [ip, requests] of this.requests.entries()) {
      const recentRequests = requests.filter(time => now - time < this.windowMs);
      if (recentRequests.length === 0) {
        this.requests.delete(ip);
      } else {
        this.requests.set(ip, recentRequests);
      }
    }
  }
}

const rateLimiter = new RateLimiter(20, 60000); // 20 requests por minuto

// Limpiar rate limiter cada minuto
setInterval(() => rateLimiter.cleanup(), 60000);

// ===== INTEGRACIÓN EN INDEX.JS =====
// index-optimizado.js
const express = require('express');

// Funciones optimizadas (importar las de arriba)
// const { simularConvertToMXNConQueue } = require('./simulador-optimizado');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware de rate limiting
app.use('/api', (req, res, next) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  
  if (!rateLimiter.isAllowed(clientIp)) {
    return res.status(429).json({
      error: 'Rate limit exceeded. Max 20 requests per minute.',
      retryAfter: 60
    });
  }
  
  next();
});

// Endpoint optimizado
app.get('/api/simular/:tipoOperacion/:moneda/:cantidad', async (req, res) => {
  const startTime = Date.now();
  const { tipoOperacion, moneda, cantidad } = req.params;

  // Validaciones (igual que antes)
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
    // Usar función optimizada con queue
    const resultado = await simularConvertToMXNConQueue(moneda, num, tipoOperacion);
    
    // Agregar tiempo de procesamiento
    resultado.processingTime = `${Date.now() - startTime}ms`;
    
    res.json(resultado);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

// Endpoint de salud para monitoring
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🔄 Cerrando servidor...');
  await browserPool.close();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 API optimizada corriendo en puerto ${PORT}`);
});

module.exports = { 
  simularConvertToMXNOptimizado,
  simularConvertToMXNConCache,
  simularConvertToMXNConQueue,
  BrowserPool,
  CacheManager,
  QueueManager,
  RateLimiter
};
