const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

async function simularConvertToMXNConBrowser(moneda = 'USD', cantidad = 100, tipoOperacion = 'compra') {
  let browser = null;
  
  try {
    console.log('🚀 Iniciando browser...');
    
    // Obtener la ruta del ejecutable de forma más segura
    let executablePath;
    try {
      executablePath = await chromium.executablePath();
      console.log('🔍 Ruta del ejecutable:', executablePath);
    } catch (pathError) {
      console.log('⚠️ Error obteniendo ruta, usando alternativa...');
      executablePath = '/usr/bin/chromium-browser';
    }
    
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: executablePath,
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    
    // Configurar User-Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    console.log('📱 Navegando a Banregio...');
    await page.goto('https://www.banregio.com/divisas.php', { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    
    console.log('⏳ Esperando elementos...');
    await page.waitForSelector('#divisa', { timeout: 15000 });
    await page.waitForSelector('.custom-select', { timeout: 15000 });
    await page.waitForSelector('#mxn', { timeout: 15000 });
    
    console.log(`💱 Seleccionando ${moneda}...`);
    await page.select('.custom-select', moneda);
    
    console.log(`💰 Ingresando cantidad: ${cantidad}...`);
    await page.click('#divisa');
    await page.keyboard.selectAll();
    await page.keyboard.type(String(cantidad), { delay: 50 });
    
    console.log(`🔘 Seleccionando operación: ${tipoOperacion}...`);
    const botonTexto = tipoOperacion === 'compra' ? 'Quiero comprar' : 'Quiero vender';
    const [boton] = await page.$x(`//button[contains(., '${botonTexto}')]`);
    
    if (!boton) {
      throw new Error(`Botón "${botonTexto}" no encontrado`);
    }
    
    await boton.click();
    
    console.log('⏳ Esperando resultado...');
    await page.waitForFunction(() => {
      const el = document.querySelector('#mxn');
      return el && parseFloat(el.value) > 0;
    }, { timeout: 10000 });
    
    const mxn = await page.$eval('#mxn', el => el.value);
    const tipoCambio = (parseFloat(mxn) / cantidad).toFixed(4);
    
    console.log('✅ Conversión exitosa:', { moneda, cantidad, mxn: parseFloat(mxn), tipoCambio: parseFloat(tipoCambio) });
    
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
    console.error('❌ Error en simulación:', error.message);
    console.error('📍 Stack trace:', error.stack);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log('🔒 Browser cerrado');
      } catch (closeError) {
        console.error('⚠️ Error cerrando browser:', closeError.message);
      }
    }
  }
}

module.exports = { simularConvertToMXNConBrowser };
